"""
asr_model_test.py — is our non-English WER the model, or the recogniser?

The v2 corpus was scored with `whisper small` (run_batch's default). Portuguese and
French came out markedly worse than en/es/de, but the failures looked like recogniser
breakdowns rather than synthesis defects (e.g. 'xarope' transcribed as the ENGLISH word
'syrup'). If that's right, a larger ASR model should close much of the gap — and the
"Portuguese is our weakest language" reading would be an artifact of our own tooling.

This re-transcribes a sample with large-v3 and compares normalized WER against the
small-model numbers already on disk. It does NOT write results.json — mixing ASR model
versions in one results file would be worse than the problem it's diagnosing.

No API key, no credits: faster-whisper pulls weights from HuggingFace and runs locally.

Run:  uv run python corpus/asr_model_test.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import jiwer
from evaluate import load_asr, normalize_for_wer

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "outputs" / "results.json"
MANIFEST = HERE / "manifest_125.jsonl"
BIG_MODEL = "large-v3"


def main():
    rows = {r["id"]: r for r in json.load(open(RESULTS))}
    man = {json.loads(l)["id"]: json.loads(l) for l in open(MANIFEST)}

    # The clips the small model struggled with, plus clean controls in the languages
    # that already scored well — if large-v3 also moves those, the effect is not
    # language-specific and the hypothesis is wrong.
    worst = [r for r in rows.values() if r["wer_pct"] > 0 and r["lang"] in ("pt", "fr")]
    worst.sort(key=lambda r: -r["wer_pct"])
    sample = worst[:10]
    controls = [rows[i] for i in ("cs-01-en", "bank-01-de", "bank-02-es") if i in rows]
    sample += controls

    print(f"loading faster-whisper '{BIG_MODEL}' (downloads ~3GB on first run)...", flush=True)
    asr = load_asr(BIG_MODEL)

    print(f"\n{'id':15}{'lang':5}{'small':>8}{'large-v3':>10}{'delta':>8}")
    deltas = []
    for r in sample:
        cid = r["id"]
        wav = HERE / "outputs" / f"{cid}.wav"
        if not wav.exists():
            continue
        lang = r["lang"]
        segments, _ = asr.transcribe(str(wav), language=lang, beam_size=5)
        hyp = " ".join(s.text for s in segments).strip()
        ref = man[cid]["text"]
        new = jiwer.process_words(normalize_for_wer(ref, lang),
                                  normalize_for_wer(hyp, lang)).wer * 100
        old = r["wer_pct"]
        tag = "  <-- control" if cid in ("cs-01-en", "bank-01-de", "bank-02-es") else ""
        print(f"{cid:15}{lang:5}{old:7.1f}%{new:9.1f}%{new-old:+7.1f}{tag}")
        deltas.append((cid, lang, old, new, hyp, ref))

    print("\n--- transcripts that changed most ---")
    for cid, lang, old, new, hyp, ref in sorted(deltas, key=lambda d: d[3] - d[2])[:5]:
        if new >= old:
            continue
        print(f"{cid}  {old:.1f}% -> {new:.1f}%")
        print(f"   SRC:      {ref}")
        print(f"   large-v3: {hyp}")

    tested = [d for d in deltas if d[0] not in ("cs-01-en", "bank-01-de", "bank-02-es")]
    if tested:
        mo = sum(d[2] for d in tested) / len(tested)
        mn = sum(d[3] for d in tested) / len(tested)
        print(f"\npt/fr sample mean WER: small {mo:.1f}%  ->  large-v3 {mn:.1f}%  ({mn-mo:+.1f})")


if __name__ == "__main__":
    main()
