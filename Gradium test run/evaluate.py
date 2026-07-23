"""
evaluate.py — reference-free evaluation metrics for a single TTS WAV file.

Three metric families, none requiring ground-truth reference audio:
  1. Signal sanity   — duration, peak/RMS dBFS, clipping %, LUFS, edge silence, rough SNR.
  2. Intelligibility — Whisper transcription vs. input text -> WER / CER (needs --text).
  3. Predicted MOS   — UTMOS22-strong (wav2vec2), naturalness score in [1, 5].

Run (matches the .env setup; no API key needed — this is offline):
    uv run python evaluate.py                          # defaults to narrateur_en.wav
    uv run python evaluate.py --wav out.wav --text "the reference transcript"
    uv run python evaluate.py --text-file script.txt --asr-model small

Every metric is reference-free: WER compares the audio's *own* words to the text you
asked it to speak (intelligibility), not to a gold audio render.
"""

import argparse
import re
import sys

import numpy as np
import soundfile as sf

SILENCE_DBFS = -40.0  # frames quieter than this at the edges count as silence


def _dbfs(x):
    return 20.0 * np.log10(max(float(x), 1e-12))


def load_mono(path):
    """Return (float32 mono samples in [-1, 1], sample_rate)."""
    wav, sr = sf.read(path, dtype="float32")
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    return wav, sr


def signal_sanity(wav, sr):
    import pyloudnorm as pyln

    n = len(wav)
    duration = n / sr
    peak = np.max(np.abs(wav)) if n else 0.0
    rms = np.sqrt(np.mean(wav ** 2)) if n else 0.0
    clip_frac = float(np.mean(np.abs(wav) >= 0.999)) if n else 0.0

    # Integrated loudness (LUFS) per ITU-R BS.1770; needs >= ~0.4s of audio.
    try:
        lufs = pyln.Meter(sr).integrated_loudness(wav)
    except Exception:
        lufs = float("nan")

    # Edge silence via 20 ms frame energy.
    frame = max(1, int(0.020 * sr))
    n_frames = n // frame
    if n_frames:
        energy = wav[: n_frames * frame].reshape(n_frames, frame)
        frame_db = 10.0 * np.log10(np.mean(energy ** 2, axis=1) + 1e-12)
        voiced = np.where(frame_db > SILENCE_DBFS)[0]
        if len(voiced):
            lead = voiced[0] * frame / sr
            trail = (n_frames - 1 - voiced[-1]) * frame / sr
            # Rough SNR: loud (95th pct) vs. quiet-floor (10th pct) frame energy.
            snr = float(np.percentile(frame_db, 95) - np.percentile(frame_db, 10))
        else:
            lead = trail = duration
            snr = float("nan")
    else:
        lead = trail = 0.0
        snr = float("nan")

    return {
        "duration_s": duration,
        "peak_dbfs": _dbfs(peak),
        "rms_dbfs": _dbfs(rms),
        "clipping_pct": clip_frac * 100.0,
        "lufs": lufs,
        "lead_silence_s": lead,
        "trail_silence_s": trail,
        "snr_db_est": snr,
    }


MIN_PAUSE_S = 0.15  # internal silence at least this long counts as a deliberate pause


def prosody(wav, sr, n_words=None):
    """D-NAT-1 (monotone) + D-NAT-3 (pausing/rate) objective signals — reference-free.

    F0 spread is reported in semitones (perceptual, speaker-independent) as well as Hz;
    a monotone/flat render shows a small f0_semitone_std. Pause and speaking-rate stats
    come from 20 ms frame energy: internal silences >= MIN_PAUSE_S are counted as pauses,
    and speaking rate is words over voiced (non-pause) time = articulation rate.
    """
    import librosa

    # --- F0 via probabilistic YIN (voiced frames only) ---
    f0, _, _ = librosa.pyin(wav, fmin=65, fmax=400, sr=sr)
    voiced_f0 = f0[~np.isnan(f0)] if f0 is not None else np.array([])
    if len(voiced_f0):
        f0_mean = float(np.mean(voiced_f0))
        f0_std = float(np.std(voiced_f0))
        semitones = 12.0 * np.log2(voiced_f0 / f0_mean)
        f0_semitone_std = float(np.std(semitones))
    else:
        f0_mean = f0_std = f0_semitone_std = float("nan")

    # --- Pauses + rate from 20 ms frame energy ---
    frame = max(1, int(0.020 * sr))
    n_frames = len(wav) // frame
    n_pauses = 0
    pause_total_s = 0.0
    speech_s = 0.0
    if n_frames:
        energy = wav[: n_frames * frame].reshape(n_frames, frame)
        frame_db = 10.0 * np.log10(np.mean(energy ** 2, axis=1) + 1e-12)
        voiced = frame_db > SILENCE_DBFS
        idx = np.where(voiced)[0]
        if len(idx):
            first, last = idx[0], idx[-1]
            speech_s = float(np.sum(voiced[first : last + 1]) * frame / sr)
            run = 0
            for f in range(first, last + 1):  # count internal silence runs only
                if not voiced[f]:
                    run += 1
                else:
                    if run * frame / sr >= MIN_PAUSE_S:
                        n_pauses += 1
                        pause_total_s += run * frame / sr
                    run = 0

    rate_wps = (n_words / speech_s) if (n_words and speech_s) else float("nan")
    return {
        "f0_mean_hz": f0_mean,
        "f0_std_hz": f0_std,
        "f0_semitone_std": f0_semitone_std,
        "n_pauses": n_pauses,
        "pause_total_s": pause_total_s,
        "speaking_rate_wps": rate_wps,
    }


def load_asr(model_size):
    """Load the ASR model, tagging it with its name.

    The tag matters: a WER figure is uninterpretable without knowing which recogniser
    produced it. Measured on this corpus, `small` vs `large-v3` moved Portuguese WER
    from 10.68% to 4.70% with the audio unchanged — an instrument artifact that reads
    exactly like a model defect. The name is recorded on every scored row.
    """
    from faster_whisper import WhisperModel
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    model._soundcheck_name = model_size
    return model


def _trailing_deletions(alignment):
    """Ref words deleted at the very tail of the alignment — a truncation signal (D-INT-5).

    A model that cuts off early leaves the last words of the reference unspoken, so
    they show up as delete chunks at the end of the aligned sequence.
    """
    if not alignment or not alignment[0]:
        return 0
    total = 0
    for chunk in reversed(alignment[0]):
        if chunk.type == "delete":
            total += chunk.ref_end_idx - chunk.ref_start_idx
        else:
            break
    return total


# --- WER text normalization -------------------------------------------------
#
# Raw WER over formatted text measures the RECOGNISER'S WRITING CONVENTIONS as much
# as the model's speech. Observed on this corpus: a spelled-out code "A, 7, 3, 9, K, 2"
# (6 reference tokens) comes back from Whisper as "A739K2" (1 token) -> 5 deletions +
# 1 substitution = 60% WER on audio that is very likely perfect. The identical artifact
# appeared in all five languages, which is the tell that it is transcription, not speech.
#
# These two normalizations put both sides in the same shape before alignment. They
# cannot hide a genuine error: characters are preserved, so a misread digit
# (4021 -> 8021) still aligns as a substitution.

_ALNUM_TOKEN = re.compile(r"^[^\W_]+$", re.UNICODE)


def _split_alnum_tokens(tokens):
    """Explode digit-bearing alphanumeric tokens into characters.

    'a739k2' -> a 7 3 9 k 2, matching a source written 'A, 7, 3, 9, K, 2'. Also
    reconciles digit grouping ('4.021' vs '4021') and keeps error granularity
    proportionate: one wrong digit is one substitution, not a whole-token miss.
    """
    out = []
    for t in tokens:
        if len(t) > 1 and _ALNUM_TOKEN.match(t) and any(c.isdigit() for c in t):
            out.extend(list(t))
        else:
            out.append(t)
    return out


def reconcile_splits(ref_tokens, hyp_tokens, max_join=3):
    """Reconcile split/join transcription artifacts between the two token lists.

    The mirror image of _split_alnum_tokens. That rule fixes the recogniser JOINING
    what the source spelled apart ('A, 7, 3, 9, K, 2' -> 'A739K2'); this fixes the
    recogniser SPLITTING what the source wrote joined. Observed on this corpus, in all
    five languages (the tell that it is transcription, not speech):

        proper nouns:  'Eldergrove' -> 'Elder Grove'   (game-01-*, +2 word errors each)
        emphasis caps: 'PAS'        -> 'P. A. S.'       (game-04-fr, +3 word errors)
        compounds:     'Betrugshotline' <-> 'Betrugs Hotline'  (bank-04-de)

    Adjacent tokens on one side are merged when their concatenation exactly equals a
    single token on the other side. Symmetric and exact-match only, so it can never
    turn a genuine substitution into a hit: if the model actually said different words,
    the characters will not concatenate to match. The guard skips a merge when a
    sub-token already aligns on its own, so common short words are never fused.

    It does NOT touch homophones ('Thorne' vs 'Thorn') or misheard domains: those are
    real recogniser limitations that the human adjudication pass exists to resolve, and
    normalising them away would hide exactly what the tool is built to surface.
    """
    def merge(a, others):
        out, i, n = [], 0, len(a)
        while i < n:
            hit, kk = None, 1
            for k in range(min(max_join, n - i), 1, -1):
                cand = "".join(a[i:i + k])
                if cand in others and not any(a[i + x] in others for x in range(k)):
                    hit, kk = cand, k
                    break
            if hit is not None:
                out.append(hit)
                i += kk
            else:
                out.append(a[i])
                i += 1
        return out

    return merge(ref_tokens, set(hyp_tokens)), merge(hyp_tokens, set(ref_tokens))


# --- base layer: OpenAI's Whisper text normalizers -------------------------
#
# These are the normalizers used to report WER in the Whisper paper, written by the
# authors of the recogniser we score against — the most defensible baseline available.
#
# MEASURED LIMITATION: EnglishTextNormalizer fully resolves the alphanumeric
# tokenization problem, but it is English-only. The multilingual BasicTextNormalizer
# only lowercases and strips punctuation, which leaves the artifact untouched:
#     SRC -> your confirmation code is a739k2
#     ASR -> your confirmation code is a 739k2      (still 2 tokens vs 1)
# On this corpus it moved bank-02-es 33.3% -> 33.3%, bank-02-pt 28.6% -> 28.6%,
# bank-05-fr 44.4% -> 44.4%. Hence the single extra rule below for non-English.
_ENGLISH_NORM = None
_BASIC_NORM = None


def _whisper_normalizer(lang):
    """Lazily construct the appropriate Whisper normalizer for a language."""
    global _ENGLISH_NORM, _BASIC_NORM
    if lang == "en":
        if _ENGLISH_NORM is None:
            from whisper_normalizer.english import EnglishTextNormalizer
            _ENGLISH_NORM = EnglishTextNormalizer()
        return _ENGLISH_NORM
    if _BASIC_NORM is None:
        from whisper_normalizer.basic import BasicTextNormalizer
        _BASIC_NORM = BasicTextNormalizer()
    return _BASIC_NORM


# Deliberately tiny and unambiguous: only units this corpus actually uses, where the
# recogniser abbreviates what the source spells out. German "Uhr" (o'clock) is NOT
# mapped to hour — that would be a different word, not an abbreviation.
_UNIT_ALIASES = {
    "mg": "milligram", "milligram": "milligram", "milligrams": "milligram",
    "milligramme": "milligram", "milligrammes": "milligram",
    "miligrama": "milligram", "miligramas": "milligram",
    "milligramm": "milligram",
    "h": "hour", "hour": "hour", "hours": "hour",
    "heure": "hour", "heures": "hour",
    "hora": "hour", "horas": "hour",
    "stunde": "hour", "stunden": "hour",
    "euro": "euro", "euros": "euro",
    "dollar": "dollar", "dollars": "dollar",
}


def normalize_for_wer(text, lang="en"):
    """
    Whisper's own normalizer, plus one documented rule it does not cover.

    Layer 1 (standard): EnglishTextNormalizer for English, BasicTextNormalizer
    otherwise — straight from the Whisper authors.
    Layer 2 (ours, one rule): split digit-bearing alphanumeric tokens into
    characters so 'a739k2' and 'a 739k2' compare equal. Required because
    BasicTextNormalizer leaves that mismatch in place for the four non-English
    languages (measured above). Applied to both sides, so it cannot hide a real
    error — a misread digit still aligns as a substitution.
    Layer 3 (ours, small): canonicalize a handful of unit abbreviations the
    recogniser writes short ('mg' for 'milligrammes').
    """
    t = _whisper_normalizer(lang)(strip_ssml(text))
    t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
    toks = _split_alnum_tokens(t.split())
    return " ".join(_UNIT_ALIASES.get(x, x) for x in toks)


def intelligibility(path, reference_text, model, language=None):
    import jiwer

    segments, info = model.transcribe(path, language=language, beam_size=5)
    hypothesis = " ".join(seg.text for seg in segments).strip()

    norm = jiwer.Compose([
        jiwer.ToLowerCase(),
        jiwer.RemovePunctuation(),
        jiwer.RemoveMultipleSpaces(),
        jiwer.Strip(),
        jiwer.ReduceToListOfListOfWords(),
    ])
    ref = strip_ssml(reference_text)

    # Raw: kept and reported so the size of the normalization effect stays visible.
    raw = jiwer.process_words(ref, hypothesis, reference_transform=norm, hypothesis_transform=norm)

    # Normalized: the headline figure, aligned on comparable text. Tokenise both sides,
    # reconcile split/join transcription artifacts, then align.
    lang = (language or "en").lower()[:2]
    ref_toks = (norm(normalize_for_wer(ref, lang)) or [[]])[0]
    hyp_toks = (norm(normalize_for_wer(hypothesis, lang)) or [[]])[0]
    ref_toks, hyp_toks = reconcile_splits(ref_toks, hyp_toks)
    out = jiwer.process_words(" ".join(ref_toks), " ".join(hyp_toks),
                              reference_transform=norm, hypothesis_transform=norm)
    cer = jiwer.cer(ref.lower(), hypothesis.lower())

    ref_words = out.substitutions + out.deletions + out.hits
    return {
        "detected_lang": info.language,
        "hypothesis": hypothesis,
        "wer": out.wer,
        # Unnormalized WER, for transparency about how much of the raw figure was
        # transcription convention rather than speech.
        "wer_raw": raw.wer,
        "cer": cer,
        # D-INT-3 (omission/insertion) + D-INT-6 (hallucination = large insertions):
        "ref_words": ref_words,
        "substitutions": out.substitutions,
        "insertions": out.insertions,
        "deletions": out.deletions,
        "hits": out.hits,
        "sub_rate": out.substitutions / ref_words if ref_words else 0.0,
        "ins_rate": out.insertions / ref_words if ref_words else 0.0,
        "del_rate": out.deletions / ref_words if ref_words else 0.0,
        # D-INT-5 (truncation): ref words dropped at the tail.
        "trailing_deletions": _trailing_deletions(out.alignments),
    }


NOMINAL_WPS = 2.5  # ~150 wpm — rough expected speaking rate for a duration sanity check


def truncation_check(duration_s, ref_words, trailing_deletions, trail_silence_s):
    """D-INT-5: flag early cutoff from audio-duration-vs-expected + tail word loss.

    dur_expected_ratio well below 1 means the clip is shorter than the text implies.
    We only raise `truncated` when tail words are missing AND the clip ends abruptly
    (little trailing silence), so a naturally short-but-complete render isn't flagged.
    """
    expected_s = ref_words / NOMINAL_WPS if ref_words else 0.0
    ratio = duration_s / expected_s if expected_s else float("nan")
    truncated = bool(trailing_deletions > 0 and trail_silence_s < 0.15)
    return {"expected_s": expected_s, "dur_expected_ratio": ratio, "truncated": truncated}


def load_utmos():
    import sys
    import torch

    # Drop any pip `speechmos` (DNSMOS) from the module cache so torch.hub's
    # tarepan/SpeechMOS repo can import its own speechmos.utmos22 package (name clash).
    for m in [m for m in sys.modules if m == "speechmos" or m.startswith("speechmos.")]:
        del sys.modules[m]
    return torch.hub.load("tarepan/SpeechMOS", "utmos22_strong", trust_repo=True)


def predicted_mos(wav, sr, model):
    import torch

    with torch.no_grad():
        score = model(torch.from_numpy(wav).unsqueeze(0), sr)
    return {"utmos": float(score)}


def load_dnsmos():
    # Name collision: torch.hub's tarepan/SpeechMOS repo (used by load_utmos) ships its
    # own `speechmos` package and leaves its dir on sys.path, shadowing the pip DNSMOS
    # package. Drop that path + any cached module so the import resolves to pip speechmos.
    import sys

    import numpy as np

    for p in [p for p in sys.path if "tarepan_SpeechMOS" in p]:
        sys.path.remove(p)
    for m in [m for m in sys.modules if m == "speechmos" or m.startswith("speechmos.")]:
        del sys.modules[m]
    from speechmos import dnsmos

    # Warm up so the ONNX sessions cache in the module singleton — this makes the
    # returned object inference-safe even after load_utmos later swaps the module name.
    dnsmos.run(np.zeros(16000, dtype=np.float32), sr=16000, return_df=False)
    return dnsmos


def audio_quality(wav, sr, dnsmos):
    """D-AUD-1: DNSMOS P.835 — artifact-sensitive audio quality (SIG/BAK/OVRL + P.808).

    English-trained like UTMOS, so compare within a language only. Runs at 16 kHz.
    """
    import librosa

    x = wav if sr == 16000 else librosa.resample(wav, orig_sr=sr, target_sr=16000)
    res = dnsmos.run(x.astype(np.float32), sr=16000, return_df=False)
    return {
        "dnsmos_ovrl": float(res["ovrl_mos"]),
        "dnsmos_sig": float(res["sig_mos"]),
        "dnsmos_bak": float(res["bak_mos"]),
        "dnsmos_p808": float(res["p808_mos"]),
    }


def strip_ssml(text):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", text)).strip()


def main():
    ap = argparse.ArgumentParser(description="Reference-free TTS eval on one WAV")
    ap.add_argument("--wav", default="narrateur_en.wav")
    ap.add_argument("--text", default=None, help="reference transcript for WER/CER")
    ap.add_argument("--text-file", default=None, help="file with reference transcript")
    ap.add_argument("--lang", default=None, help="ISO code to force ASR language (else auto-detect)")
    ap.add_argument("--asr-model", default="small",
                    help="faster-whisper size: tiny|base|small|medium|large-v3")
    ap.add_argument("--skip-mos", action="store_true")
    ap.add_argument("--skip-wer", action="store_true")
    ap.add_argument("--skip-dnsmos", action="store_true")
    args = ap.parse_args()

    reference_text = args.text
    if args.text_file:
        with open(args.text_file, encoding="utf-8") as f:
            reference_text = f.read()

    wav, sr = load_mono(args.wav)
    print(f"file: {args.wav}  ({len(wav)/sr:.2f}s @ {sr} Hz)\n")

    sig = signal_sanity(wav, sr)
    print("== signal sanity ==")
    for k, v in sig.items():
        print(f"  {k:16s} {v:10.3f}" if isinstance(v, float) else f"  {k:16s} {v}")

    if not args.skip_wer:
        print("\n== intelligibility (WER) ==")
        if not reference_text:
            print("  skipped: no --text / --text-file given")
        else:
            r = intelligibility(args.wav, reference_text, load_asr(args.asr_model), language=args.lang)
            print(f"  detected_lang    {r['detected_lang']}")
            print(f"  WER              {r['wer']*100:6.2f} %")
            print(f"  CER              {r['cer']*100:6.2f} %")
            print(f"  sub/ins/del      {r['substitutions']} / {r['insertions']} / {r['deletions']}"
                  f"  (of {r['ref_words']} ref words)")
            trunc = truncation_check(sig["duration_s"], r["ref_words"],
                                     r["trailing_deletions"], sig["trail_silence_s"])
            flag = "  <-- TRUNCATED" if trunc["truncated"] else ""
            print(f"  dur/expected     {trunc['dur_expected_ratio']:6.2f}  "
                  f"(trailing_del={r['trailing_deletions']}){flag}")
            print(f"  heard: {r['hypothesis']}")

    print("\n== prosody (D-NAT-1 / D-NAT-3) ==")
    n_words = len(strip_ssml(reference_text).split()) if reference_text else None
    p = prosody(wav, sr, n_words=n_words)
    print(f"  f0_semitone_std  {p['f0_semitone_std']:8.2f}  (low = monotone/flat)")
    print(f"  f0_mean_hz       {p['f0_mean_hz']:8.1f}")
    print(f"  pauses           {p['n_pauses']}  ({p['pause_total_s']:.2f}s total)")
    rate = p["speaking_rate_wps"]
    print(f"  speaking_rate    {rate:8.2f} wps" if rate == rate else "  speaking_rate         n/a")

    if not args.skip_dnsmos:
        print("\n== audio quality (DNSMOS P.835, D-AUD-1) ==")
        aq = audio_quality(wav, sr, load_dnsmos())
        print(f"  DNSMOS OVRL      {aq['dnsmos_ovrl']:.3f}   SIG {aq['dnsmos_sig']:.3f}"
              f"   BAK {aq['dnsmos_bak']:.3f}   P808 {aq['dnsmos_p808']:.3f}")

    if not args.skip_mos:
        print("\n== predicted MOS (UTMOS22-strong) ==")
        r = predicted_mos(wav, sr, load_utmos())
        print(f"  UTMOS            {r['utmos']:.3f}  (scale 1-5)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
