"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RaterClip } from "@/lib/clips";
import {
  ACCENT_PROBE,
  LANGUAGE_NAMES,
  TAG_GROUPS,
  TAG_GROUP_ORDER,
  probeFor,
  tagsInGroup,
  type Probe,
} from "@/lib/taxonomy";
import { RatingReveal, type RevealMetrics } from "@/components/rating-reveal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Blind review flow.
 *
 * No objective metric reaches this component: /rate strips them from the payload, and
 * the reveal fetches them from /api/clip-metrics only AFTER a rating is submitted.
 * Showing a machine score first would anchor the reviewer and destroy the very
 * comparison the product is built on, so blindness is enforced by the data flow rather
 * than by remembering not to render something.
 */

const SESSION_KEY = "soundcheck.session_id";
const LANGS_KEY = "soundcheck.langs";

/**
 * The corpus is 145 clips; nobody reviews that in one sitting. Work is handed out in
 * short sets with a real finish line, so the reviewer always knows how much is left
 * and can stop at a natural boundary instead of abandoning mid-queue.
 */
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

type Phase = "gate" | "rating" | "reveal" | "setdone";

export function Rater({ clips }: { clips: RaterClip[] }) {
  const allLangs = useMemo(() => [...new Set(clips.map((c) => c.lang))].sort(), [clips]);

  const [phase, setPhase] = useState<Phase>("gate");
  const [langs, setLangs] = useState<string[]>([]);
  const [queue, setQueue] = useState<RaterClip[]>([]);
  const [index, setIndex] = useState(0);
  const [setStart, setSetStart] = useState(0);

  const [overall, setOverall] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [probeAnswers, setProbeAnswers] = useState<Record<string, string>>({});
  const [otherText, setOtherText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [reveal, setReveal] = useState<RevealMetrics | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listenedMsRef = useRef(0);
  const playStartRef = useRef<number | null>(null);
  const hasPlayedRef = useRef(false);
  const replaysRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);

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
    setOverall(null);
    setTags([]);
    setProbeAnswers({});
    setOtherText("");
    setError(null);
    setReveal(null);
    listenedMsRef.current = 0;
    playStartRef.current = null;
    hasPlayedRef.current = false;
    replaysRef.current = 0;
    setIsPlaying(false);
  }, []);

  /** Order by fewest existing ratings so coverage fills in rather than clustering. */
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
    setPhase(ordered.length ? "rating" : "setdone");
  }, [clips, langs, resetClipState]);

  const current = queue[index];
  const inSet = index - setStart;
  const targetedProbe: Probe | null = current ? probeFor(current.stress_category) : null;

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const advance = useCallback(() => {
    audioRef.current?.pause();
    if (index + 1 >= queue.length) {
      setPhase("setdone");
      return;
    }
    setIndex(index + 1);
    resetClipState();
    setPhase("rating");
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
    setPhase("rating");
  }, [index, resetClipState]);

  const submit = useCallback(async () => {
    if (!current || overall === null) return;
    if (playStartRef.current !== null) {
      listenedMsRef.current += Date.now() - playStartRef.current;
      playStartRef.current = null;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: getSessionId(),
          clip_id: current.id,
          overall,
          defect_tags: tags,
          probes: probeAnswers,
          other_text: tags.includes("other") ? otherText : null,
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

      // Metrics are fetched only now, after the judgement is locked in.
      try {
        const mr = await fetch(`/api/clip-metrics?id=${encodeURIComponent(current.id)}`, {
          cache: "no-store",
        });
        if (mr.ok) {
          const { metrics } = (await mr.json()) as { metrics: RevealMetrics };
          setReveal(metrics);
          setPhase("reveal");
          return;
        }
      } catch {
        /* the rating is saved; a failed reveal must not lose it */
      }
      advance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
    } finally {
      setSubmitting(false);
    }
  }, [current, overall, tags, probeAnswers, otherText, advance]);

  const nextFromReveal = useCallback(() => {
    if (inSet + 1 >= SET_SIZE) {
      audioRef.current?.pause();
      setPhase("setdone");
      return;
    }
    advance();
  }, [inSet, advance]);

  const continueSet = useCallback(() => {
    if (index + 1 >= queue.length) return;
    setSetStart(index + 1);
    setIndex(index + 1);
    resetClipState();
    setPhase("rating");
  }, [index, queue.length, resetClipState]);

  // Keyboard: space play/pause, 1-5 score, Enter submit/next, S skip, B back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if (phase === "reveal") {
        if (e.key === "Enter" || e.code === "Space") {
          e.preventDefault();
          nextFromReveal();
        }
        return;
      }
      if (phase !== "rating") return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (["1", "2", "3", "4", "5"].includes(e.key)) {
        setOverall(Number(e.key));
      } else if (e.key === "Enter" && overall !== null && !submitting) {
        e.preventDefault();
        void submit();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        skip();
      } else if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, togglePlay, submit, overall, submitting, skip, goBack, nextFromReveal]);

  // ---------- Language gate ----------
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
            This one question is what keeps the signal usable.
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
          <p className="font-medium text-foreground">What you are being asked for</p>
          <p className="mt-1">
            Roughly {SET_SIZE} clips per set, a few seconds each. You score how it sounds,
            then get asked one targeted question about the thing automated metrics cannot
            measure for that clip. After each one you see what the machine scored it, so you
            can see where you and the model disagree.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => void start()} disabled={langs.length === 0} size="lg">
            Start reviewing
          </Button>
          <span className="text-xs text-muted-foreground">
            {langs.length === 0
              ? "Pick at least one language"
              : `${eligible} clips available`}
          </span>
        </div>
      </div>
    );
  }

  // ---------- End of a set ----------
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
                {skipped > 0 ? ` and skipped ${skipped}` : ""}. Your answers to the targeted
                questions are the only record of things no metric in the stack can measure.
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
        {remaining > 0 ? (
          <p className="text-xs text-muted-foreground">{remaining} clips left in your languages</p>
        ) : null}
      </div>
    );
  }

  if (!current) return null;

  // ---------- Reveal ----------
  if (phase === "reveal" && reveal) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 pb-8">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono">{current.id}</span>
          <span>
            {inSet + 1} of {Math.min(SET_SIZE, queue.length - setStart)} in this set
          </span>
        </div>
        <RatingReveal
          sourceText={current.text}
          overall={overall ?? 0}
          metrics={reveal}
          probeAnswers={probeAnswers}
          stressCategory={current.stress_category}
        />
        <div className="flex items-center gap-3">
          <Button size="lg" onClick={nextFromReveal}>
            {inSet + 1 >= SET_SIZE || index + 1 >= queue.length ? "Finish set" : "Next clip"}
          </Button>
          <span className="text-xs text-muted-foreground">
            or press <kbd className="rounded border px-1 font-mono">enter</kbd>
          </span>
        </div>
      </div>
    );
  }

  // ---------- Rating ----------
  const canSubmit = overall !== null && !submitting;
  const setTotal = Math.min(SET_SIZE, queue.length - setStart);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-10">
      {/* progress + escape hatches */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Clip {inSet + 1} of {setTotal}
            <span className="ml-2 opacity-60">({submittedCount} done overall)</span>
          </span>
          <div className="flex items-center gap-3">
            {index > 0 ? (
              <button type="button" onClick={goBack} className="hover:text-foreground">
                Back
              </button>
            ) : null}
            <button type="button" onClick={skip} className="hover:text-foreground">
              Skip
            </button>
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

      {/* the clip */}
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{LANGUAGE_NAMES[current.lang] ?? current.lang}</Badge>
            <Badge variant="outline">{current.voice_name}</Badge>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {current.audio_s.toFixed(1)}s
            </span>
          </div>

          <blockquote className="rounded-md border-l-2 bg-muted/40 px-4 py-3 text-base leading-relaxed">
            {current.text}
          </blockquote>

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
              setIsPlaying(true);
            }}
            onPause={() => {
              if (playStartRef.current !== null) {
                listenedMsRef.current += Date.now() - playStartRef.current;
                playStartRef.current = null;
              }
              setIsPlaying(false);
            }}
            onEnded={() => setIsPlaying(false)}
          />

          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={togglePlay}>
              {isPlaying ? "Pause" : hasPlayedRef.current ? "Replay" : "Play"}
            </Button>
            <span className="text-xs text-muted-foreground">
              <kbd className="rounded border px-1 font-mono">space</kbd> play ·{" "}
              <kbd className="rounded border px-1 font-mono">1-5</kbd> score ·{" "}
              <kbd className="rounded border px-1 font-mono">s</kbd> skip
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 1. the gut score, the only required field */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">How good does it sound?</h2>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setOverall(n)}
              className={cn(
                "h-12 flex-1 rounded-md border text-sm font-medium transition-colors",
                overall === n
                  ? "border-foreground bg-foreground text-background"
                  : "hover:bg-muted",
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>1: unusable</span>
          <span>5: indistinguishable from human</span>
        </div>
      </div>

      {/* 2. the targeted probe — the reason a human is in the loop at all */}
      {targetedProbe ? (
        <ProbeBlock
          probe={targetedProbe}
          value={probeAnswers[targetedProbe.id]}
          onChange={(v) =>
            setProbeAnswers((p) => ({ ...p, [targetedProbe.id]: v }))
          }
          highlight
        />
      ) : null}

      <ProbeBlock
        probe={ACCENT_PROBE}
        value={probeAnswers[ACCENT_PROBE.id]}
        onChange={(v) => setProbeAnswers((p) => ({ ...p, [ACCENT_PROBE.id]: v }))}
      />

      {/* 3. optional defect tags */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Anything else wrong? (optional)</h2>
          <p className="text-xs text-muted-foreground">
            Skip this if it sounded fine.
          </p>
        </div>
        <div className="space-y-3">
          {TAG_GROUP_ORDER.map((groupId) => {
            const group = TAG_GROUPS[groupId];
            const groupTags = tagsInGroup(groupId);
            if (groupTags.length === 0) return null;
            return (
              <div key={groupId} className="space-y-1.5">
                <h3 className="text-xs font-semibold tracking-tight text-muted-foreground">
                  {group.label}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {groupTags.map((t) => {
                    const on = tags.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          setTags((prev) =>
                            on ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                          )
                        }
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition-colors",
                          on
                            ? "border-foreground bg-foreground text-background"
                            : "hover:bg-muted",
                        )}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {tags.includes("other") ? (
          <textarea
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="Describe what you heard…"
            rows={2}
            maxLength={500}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        ) : null}
      </div>

      {error ? (
        <Alert className="border-red-500/30 bg-red-500/5">
          <AlertTitle className="text-sm">Could not save that rating</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-3">
        <Button onClick={() => void submit()} disabled={!canSubmit} size="lg">
          {submitting ? "Saving…" : "Submit"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {overall === null ? "Score the clip to continue" : "or press enter"}
        </span>
      </div>
    </div>
  );
}

/** One targeted question, rendered as single-select chips. */
function ProbeBlock({
  probe,
  value,
  onChange,
  highlight = false,
}: {
  probe: Probe;
  value?: string;
  onChange: (v: string) => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg p-4",
        highlight ? "border border-amber-500/40 bg-amber-500/5" : "border bg-card",
      )}
    >
      <div>
        <h2 className="text-sm font-medium">{probe.question}</h2>
        {probe.hint ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{probe.hint}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {probe.options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              value === o.value
                ? "border-foreground bg-foreground text-background"
                : "bg-background hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
