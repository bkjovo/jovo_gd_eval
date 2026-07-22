"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RaterClip } from "@/lib/clips";
import { LANGUAGE_NAMES } from "@/lib/taxonomy";
import {
  ADJUDICATION,
  DELIVERY_PROBLEMS,
  TONES,
  type Annotation,
  type WordFlag,
} from "@/lib/annotation";
import { diffWords } from "@/lib/word-diff";
import { WordTagger } from "@/components/word-tagger";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Blind review flow, in three passes.
 *
 * There is deliberately NO reveal of machine scores between clips. Showing a reviewer
 * what UTMOS said after each clip would let them calibrate to it over a session:
 * clip 1's score quietly teaching them what a "4" is supposed to mean by clip 5. The
 * comparison belongs on the dashboard, computed across many reviewers, not in the
 * reviewer's own feedback loop.
 *
 *   1. ACCURACY   — source text on screen; tap the words that went wrong.
 *   2. IMPRESSION — how it sounds, judged holistically. Deliberately separated from
 *      pass 1 by a scroll, because analytic and gestalt judgements contaminate each
 *      other when collected together.
 *   3. ADJUDICATION — only when the recogniser disagreed with the source, and only on
 *      the disputed words. Runs LAST so the metric's verdict cannot anchor the score
 *      given in pass 2.
 *
 * Pass 1 shows the SOURCE text, never the transcript. A dropped word does not appear
 * in a transcript at all, so it could not be tapped; and the transcript carries the
 * recogniser's own errors, which a reviewer would faithfully attribute to the model.
 * The transcript appears in pass 3 and in the reveal, where the contrast is the point.
 *
 * No quality metric reaches this component at all: /rate is served a metrics-stripped
 * payload and /api/clip-transcript returns only the transcript, never a score.
 */

const SESSION_KEY = "soundcheck.session_id";
const LANGS_KEY = "soundcheck.langs";
const SET_SIZE = 10;

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

type Phase = "gate" | "accuracy" | "impression" | "adjudication" | "setdone";

type Transcript = { hypothesis: string; wer_pct: number };

export function Rater({ clips }: { clips: RaterClip[] }) {
  const allLangs = useMemo(() => [...new Set(clips.map((c) => c.lang))].sort(), [clips]);

  const [phase, setPhase] = useState<Phase>("gate");
  const [langs, setLangs] = useState<string[]>([]);
  const [queue, setQueue] = useState<RaterClip[]>([]);
  const [index, setIndex] = useState(0);
  const [setStart, setSetStart] = useState(0);

  // pass 1
  const [wordFlags, setWordFlags] = useState<WordFlag[]>([]);
  const [cutOff, setCutOff] = useState<boolean | null>(null);
  // pass 2
  const [audioIssue, setAudioIssue] = useState<boolean | null>(null);
  const [humanScore, setHumanScore] = useState<number | null>(null);
  const [tone, setTone] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<string[]>([]);
  // pass 3
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [adjudication, setAdjudication] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [skipped, setSkipped] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listenedMsRef = useRef(0);
  const playStartRef = useRef<number | null>(null);
  const hasPlayedRef = useRef(false);
  const replaysRef = useRef(0);
  const topRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as string[];
        if (Array.isArray(parsed) && parsed.length) setLangs(parsed);
      } catch {
        /* ignore malformed cache */
      }
    }
  }, []);

  const resetClipState = useCallback(() => {
    setWordFlags([]);
    setCutOff(null);
    setAudioIssue(null);
    setHumanScore(null);
    setTone(null);
    setDelivery([]);
    setTranscript(null);
    setAdjudication({});
    setError(null);
    listenedMsRef.current = 0;
    playStartRef.current = null;
    hasPlayedRef.current = false;
    replaysRef.current = 0;
  }, []);

  const start = useCallback(async () => {
    const eligible = clips.filter((c) => langs.includes(c.lang));
    let counts: Record<string, number> = {};
    try {
      const res = await fetch("/api/ratings", { cache: "no-store" });
      if (res.ok) {
        const { ratings } = (await res.json()) as { ratings: { clip_id: string }[] };
        counts = ratings.reduce<Record<string, number>>((acc, r) => {
          acc[r.clip_id] = (acc[r.clip_id] ?? 0) + 1;
          return acc;
        }, {});
      }
    } catch {
      /* coverage data is an optimisation, not a requirement */
    }
    const ordered = [...eligible]
      .map((c) => ({ c, n: counts[c.id] ?? 0, r: Math.random() }))
      .sort((a, b) => a.n - b.n || a.r - b.r)
      .map((x) => x.c);

    window.localStorage.setItem(LANGS_KEY, JSON.stringify(langs));
    setQueue(ordered);
    setIndex(0);
    setSetStart(0);
    resetClipState();
    setPhase(ordered.length ? "accuracy" : "setdone");
  }, [clips, langs, resetClipState]);

  const current = queue[index];
  const inSet = index - setStart;
  const setTotal = Math.min(SET_SIZE, Math.max(1, queue.length - setStart));

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const flushListening = () => {
    if (playStartRef.current !== null) {
      listenedMsRef.current += Date.now() - playStartRef.current;
      playStartRef.current = null;
    }
  };

  const advance = useCallback(() => {
    audioRef.current?.pause();
    if (index + 1 >= queue.length) {
      setPhase("setdone");
      return;
    }
    setIndex(index + 1);
    resetClipState();
    setPhase("accuracy");
  }, [index, queue.length, resetClipState]);

  const skip = useCallback(() => {
    setSkipped((n) => n + 1);
    advance();
  }, [advance]);

  const goBack = useCallback(() => {
    if (index === 0) return;
    audioRef.current?.pause();
    setIndex(index - 1);
    resetClipState();
    setPhase("accuracy");
  }, [index, resetClipState]);

  const submitAll = useCallback(
    async (adj: Record<string, string>) => {
      if (!current || humanScore === null) return;
      flushListening();
      setSubmitting(true);
      setError(null);

      const annotation: Annotation = {
        ...(wordFlags.length ? { word_flags: wordFlags } : {}),
        cut_off: cutOff,
        audio_issue: audioIssue,
        tone,
        ...(delivery.length ? { delivery_problems: delivery } : {}),
        ...(Object.keys(adj).length ? { adjudication: adj } : {}),
      };

      try {
        const res = await fetch("/api/ratings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: getSessionId(),
            clip_id: current.id,
            overall: humanScore,
            defect_tags: [],
            probes: annotation,
            listened_ms: listenedMsRef.current,
            replays: replaysRef.current,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `submit failed (${res.status})`);
        }
        setSubmittedCount((n) => n + 1);
        audioRef.current?.pause();
        advance();
      } catch (err) {
        setError(err instanceof Error ? err.message : "submit failed");
      } finally {
        setSubmitting(false);
      }
    },
    [current, humanScore, wordFlags, cutOff, audioIssue, tone, delivery, advance],
  );

  /** Pass 1 -> 2. Scrolling to the top is the deliberate cognitive reset. */
  const toImpression = useCallback(() => {
    setPhase("impression");
    requestAnimationFrame(() =>
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, []);

  /**
   * Pass 2 -> 3 or straight to submit. The transcript is fetched only now, after the
   * holistic score is locked, so nothing about the recogniser can anchor it.
   */
  const afterImpression = useCallback(async () => {
    if (!current) return;
    flushListening();
    try {
      const res = await fetch(`/api/clip-transcript?id=${encodeURIComponent(current.id)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const t = (await res.json()) as Transcript;
        if (t.wer_pct > 0 && t.hypothesis) {
          setTranscript(t);
          setPhase("adjudication");
          requestAnimationFrame(() =>
            topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
          );
          return;
        }
      }
    } catch {
      /* adjudication is a bonus; never block the submission on it */
    }
    void submitAll({});
  }, [current, submitAll]);

  const continueSet = useCallback(() => {
    if (index + 1 >= queue.length) return;
    setSetStart(index + 1);
    setIndex(index + 1);
    resetClipState();
    setPhase("accuracy");
  }, [index, queue.length, resetClipState]);

  // Space plays on the two listening passes; digits score on pass 2 only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(t.tagName)) return;
      if (phase !== "accuracy" && phase !== "impression") return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (phase === "impression" && ["1", "2", "3", "4", "5"].includes(e.key)) {
        setHumanScore(Number(e.key));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, togglePlay]);

  // ---------- Gate ----------
  if (phase === "gate") {
    const eligible = clips.filter((c) => langs.includes(c.lang)).length;
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Which languages do you understand?
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You will only be asked about clips in the languages you pick. Judging whether
            speech is intelligible in a language you do not speak produces noise, not data.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {allLangs.map((l) => {
            const on = langs.includes(l);
            return (
              <button
                key={l}
                type="button"
                onClick={() =>
                  setLangs((prev) => (on ? prev.filter((x) => x !== l) : [...prev, l]))
                }
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition-colors",
                  on ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                )}
              >
                {LANGUAGE_NAMES[l] ?? l}
              </button>
            );
          })}
        </div>
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">How it works</p>
          <p className="mt-1">
            {SET_SIZE} clips per set. For each one you listen twice: first tapping any words
            that came out wrong, then judging how it sounds overall. At the end you see what
            the machine scored it, so you can tell where you and the model disagree.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => void start()} disabled={langs.length === 0} size="lg">
            Start reviewing
          </Button>
          <span className="text-xs text-muted-foreground">
            {langs.length === 0 ? "Pick at least one language" : `${eligible} clips available`}
          </span>
        </div>
      </div>
    );
  }

  // ---------- End of set ----------
  if (phase === "setdone") {
    const remaining = Math.max(0, queue.length - index - 1);
    return (
      <div className="mx-auto max-w-xl space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {submittedCount > 0 ? "Set complete" : "Nothing to review"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {submittedCount > 0 ? (
              <>
                You reviewed {submittedCount} clip{submittedCount === 1 ? "" : "s"}
                {skipped > 0 ? ` and skipped ${skipped}` : ""}. The word-level flags and
                tone answers are the only record of things no metric here can measure.
              </>
            ) : (
              <>No clips matched the languages you selected.</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {remaining > 0 ? (
            <Button size="lg" onClick={continueSet}>
              Review {Math.min(SET_SIZE, remaining)} more
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setPhase("gate")}>
            Change languages
          </Button>
          <Link
            href="/metrics"
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
          >
            See the dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!current) return null;

  const header = (
    <div className="space-y-2" ref={topRef}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Clip {inSet + 1} of {setTotal}
          <span className="ml-2 opacity-60">({submittedCount} done)</span>
        </span>
        <div className="flex items-center gap-3">
          {index > 0 && phase === "accuracy" ? (
            <button type="button" onClick={goBack} className="hover:text-foreground">
              Back
            </button>
          ) : null}
          {phase === "accuracy" ? (
            <button type="button" onClick={skip} className="hover:text-foreground">
              Skip
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setPhase("gate")}
            className="hover:text-foreground"
          >
            Languages
          </button>
        </div>
      </div>
      <Progress value={(inSet / setTotal) * 100} className="h-1" />
    </div>
  );

  const player = (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{LANGUAGE_NAMES[current.lang] ?? current.lang}</Badge>
          <Badge variant="outline">{current.voice_name}</Badge>
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {current.audio_s.toFixed(1)}s
          </span>
        </div>
        <audio
          ref={audioRef}
          src={current.audio_url}
          preload="auto"
          controls
          className="w-full"
          onPlay={() => {
            if (hasPlayedRef.current) replaysRef.current += 1;
            hasPlayedRef.current = true;
            playStartRef.current = Date.now();
          }}
          onPause={flushListening}
        />
      </CardContent>
    </Card>
  );

  // ---------- Pass 1: accuracy ----------
  if (phase === "accuracy") {
    return (
      <div className="mx-auto max-w-2xl space-y-6 pb-10">
        {header}
        {player}
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Tap any words that came out wrong</h2>
            <p className="text-xs text-muted-foreground">
              This is the text the model was asked to read.
            </p>
          </div>
          <WordTagger text={current.text} flags={wordFlags} onChange={setWordFlags} />
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium">Did the audio cut off any words?</h2>
          <div className="flex gap-2">
            {[
              { v: true, label: "Yes" },
              { v: false, label: "No" },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setCutOff(o.v)}
                className={cn(
                  "h-11 flex-1 rounded-md border text-sm font-medium transition-colors",
                  cutOff === o.v
                    ? "border-foreground bg-foreground text-background"
                    : "hover:bg-muted",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button size="lg" onClick={toImpression} disabled={cutOff === null}>
            Next
          </Button>
          <span className="text-xs text-muted-foreground">
            {cutOff === null ? "Answer the cut-off question to continue" : "Now judge how it sounds"}
          </span>
        </div>
      </div>
    );
  }

  // ---------- Pass 2: impression ----------
  if (phase === "impression") {
    return (
      <div className="mx-auto max-w-2xl space-y-6 pb-10">
        {header}
        {player}
        <blockquote className="rounded-md border-l-2 bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          {current.text}
        </blockquote>

        <div className="space-y-2">
          <h2 className="text-sm font-medium">Were there any audio issues?</h2>
          <div className="flex gap-2">
            {[
              { v: true, label: "Yes: buzzing, garbled or glitchy" },
              { v: false, label: "No" },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setAudioIssue(o.v)}
                className={cn(
                  "h-11 flex-1 rounded-md border px-2 text-sm font-medium transition-colors",
                  audioIssue === o.v
                    ? "border-foreground bg-foreground text-background"
                    : "hover:bg-muted",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium">
            Does this sound like a real human, or like a machine?
          </h2>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setHumanScore(n)}
                className={cn(
                  "h-12 flex-1 rounded-md border text-sm font-medium transition-colors",
                  humanScore === n
                    ? "border-foreground bg-foreground text-background"
                    : "hover:bg-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between gap-2 text-[11px] text-muted-foreground sm:text-xs">
            <span>1: pure robot</span>
            <span>5: real human</span>
          </div>
        </div>

        <ChipGroup
          title="What tone did you hear?"
          options={TONES}
          value={tone}
          onChange={setTone}
        />

        {humanScore !== null && humanScore < 5 ? (
          <div className="space-y-2">
            <h2 className="text-sm font-medium">What made it sound off? (optional)</h2>
            <div className="flex flex-wrap gap-2">
              {DELIVERY_PROBLEMS.map((d) => {
                const on = delivery.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() =>
                      setDelivery((prev) =>
                        on ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                      )
                    }
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      on ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {error ? (
          <Alert className="border-red-500/30 bg-red-500/5">
            <AlertTitle className="text-sm">Could not save that rating</AlertTitle>
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            size="lg"
            onClick={() => void afterImpression()}
            disabled={humanScore === null || audioIssue === null || submitting}
          >
            {submitting ? "Saving…" : "Submit"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {humanScore === null || audioIssue === null
              ? "Answer the audio and human-likeness questions"
              : ""}
          </span>
        </div>
      </div>
    );
  }

  // ---------- Pass 3: adjudication ----------
  if (phase === "adjudication" && transcript) {
    const { srcMarks, src } = diffWords(current.text, transcript.hypothesis);
    const disputed = srcMarks.flatMap((m, i) => (m ? [i] : []));
    const answered = disputed.every((i) => adjudication[String(i)]);
    return (
      <div className="mx-auto max-w-2xl space-y-6 pb-10">
        {header}
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="space-y-4 pt-6">
            <div>
              <h2 className="text-sm font-medium">One last thing: was the metric right?</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Our speech recogniser transcribed this clip differently from the source
                text, which counted as an error. The recogniser makes its own mistakes, so
                your ear is the tiebreaker. This is asked last, on purpose, so it could not
                influence the score you just gave.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border bg-background p-3">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Text it was asked to read
                </div>
                <p className="text-sm">{current.text}</p>
              </div>
              <div className="rounded-md border bg-background p-3">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  What the recogniser wrote
                </div>
                <p className="text-sm">{transcript.hypothesis}</p>
              </div>
            </div>

            <audio src={current.audio_url} controls preload="auto" className="w-full" />

            <div className="space-y-3">
              {disputed.map((i) => (
                <div key={i} className="space-y-1.5">
                  <p className="text-sm">
                    <span className="text-muted-foreground">The word </span>
                    <span className="rounded bg-amber-500/20 px-1 font-medium">{src[i]}</span>
                    <span className="text-muted-foreground"> did not match.</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {ADJUDICATION.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() =>
                          setAdjudication((prev) => ({ ...prev, [String(i)]: a.id }))
                        }
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition-colors",
                          adjudication[String(i)] === a.id
                            ? "border-foreground bg-foreground text-background"
                            : "bg-background hover:bg-muted",
                        )}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Alert className="border-red-500/30 bg-red-500/5">
            <AlertTitle className="text-sm">Could not save that rating</AlertTitle>
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-3">
          <Button size="lg" onClick={() => void submitAll(adjudication)} disabled={submitting}>
            {submitting ? "Saving…" : "Finish clip"}
          </Button>
          {!answered ? (
            <span className="text-xs text-muted-foreground">
              You can skip any you are unsure about
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}

/** Single-select chips. */
function ChipGroup({
  title,
  hint,
  options,
  value,
  onChange,
}: {
  title: string;
  hint?: string;
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              value === o.id
                ? "border-foreground bg-foreground text-background"
                : "hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
