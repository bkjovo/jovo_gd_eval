"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RaterClip } from "@/lib/clips";
import {
  LANGUAGE_NAMES,
  TAG_GROUPS,
  TAG_GROUP_ORDER,
  tagsInGroup,
} from "@/lib/taxonomy";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Blind review flow.
 *
 * No objective metric is rendered anywhere on this page. Showing a machine score before
 * the rater commits anchors their judgement and destroys the comparison the whole
 * product depends on, so the reveal only happens after submission.
 */

const SESSION_KEY = "soundcheck.session_id";
const LANGS_KEY = "soundcheck.langs";

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

type Phase = "gate" | "rating" | "done";

export function Rater({ clips }: { clips: RaterClip[] }) {
  const allLangs = useMemo(
    () => [...new Set(clips.map((c) => c.lang))].sort(),
    [clips],
  );

  const [phase, setPhase] = useState<Phase>("gate");
  const [langs, setLangs] = useState<string[]>([]);
  const [queue, setQueue] = useState<RaterClip[]>([]);
  const [index, setIndex] = useState(0);

  const [overall, setOverall] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [otherText, setOtherText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedCount, setSubmittedCount] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listenedMsRef = useRef(0);
  const playStartRef = useRef<number | null>(null);
  const hasPlayedRef = useRef(false);
  const replaysRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Restore previously chosen languages so a returning rater skips the gate.
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
    setOtherText("");
    setError(null);
    listenedMsRef.current = 0;
    playStartRef.current = null;
    hasPlayedRef.current = false;
    replaysRef.current = 0;
    setIsPlaying(false);
  }, []);

  /**
   * Build the queue, prioritising clips with the fewest existing ratings. With a corpus
   * larger than any single sitting, random sampling leaves some clips at n=0 forever.
   */
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
    resetClipState();
    setPhase(ordered.length ? "rating" : "done");
  }, [clips, langs, resetClipState]);

  const current = queue[index];

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const submit = useCallback(async () => {
    if (!current || overall === null) return;
    // Flush any in-flight listening time before reading the total.
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
      if (index + 1 < queue.length) {
        setIndex(index + 1);
        resetClipState();
      } else {
        setPhase("done");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
    } finally {
      setSubmitting(false);
    }
  }, [current, overall, tags, otherText, index, queue.length, resetClipState]);

  // Keyboard shortcuts: space to play, 1-5 to score, Enter to submit.
  useEffect(() => {
    if (phase !== "rating") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (["1", "2", "3", "4", "5"].includes(e.key)) {
        setOverall(Number(e.key));
      } else if (e.key === "Enter" && overall !== null) {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, togglePlay, submit, overall]);

  // ---------- Language gate ----------
  if (phase === "gate") {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Which languages do you understand?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You will only be asked to review clips in the languages you select. Judging
            whether speech is intelligible in a language you do not speak produces noise,
            not data. This one question is what keeps the intelligibility signal usable.
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
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "hover:bg-muted",
                )}
              >
                {LANGUAGE_NAMES[l] ?? l}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => void start()} disabled={langs.length === 0}>
            Start reviewing
          </Button>
          <span className="text-xs text-muted-foreground">
            {langs.length === 0
              ? "Select at least one language"
              : `${clips.filter((c) => langs.includes(c.lang)).length} clips available`}
          </span>
        </div>
      </div>
    );
  }

  // ---------- Done ----------
  if (phase === "done") {
    return (
      <div className="mx-auto max-w-xl space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {submittedCount > 0 ? "Thank you, that's the queue." : "No clips available"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {submittedCount > 0
            ? `You reviewed ${submittedCount} clip${submittedCount === 1 ? "" : "s"}. Your input is aggregated by defect category and compared against what the automated metrics detected.`
            : "No clips matched the languages you selected."}
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={() => setPhase("gate")}>
            Change languages
          </Button>
          <Link
            href="/metrics"
            className="inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
          >
            See what the metrics found →
          </Link>
        </div>
      </div>
    );
  }

  // ---------- Rating ----------
  if (!current) return null;
  const canSubmit = overall !== null && !submitting;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Clip {index + 1} of {queue.length}
          </span>
          <button
            type="button"
            onClick={() => setPhase("gate")}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Change languages
          </button>
        </div>
        <Progress value={((index) / queue.length) * 100} className="h-1" />
      </div>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{LANGUAGE_NAMES[current.lang] ?? current.lang}</Badge>
            <Badge variant="outline">{current.voice_name}</Badge>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {current.audio_s.toFixed(1)}s
            </span>
          </div>

          {/* The rater needs the source text to judge intelligibility at all. */}
          <blockquote className="rounded-md border-l-2 bg-muted/40 px-4 py-3 text-base leading-relaxed">
            {current.text}
          </blockquote>

          <audio
            ref={audioRef}
            src={current.audio_url}
            preload="auto"
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
            className="w-full"
            controls
          />

          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={togglePlay}>
              {isPlaying ? "Pause" : hasPlayedRef.current ? "Replay" : "Play"}
            </Button>
            <span className="text-xs text-muted-foreground">
              or press <kbd className="rounded border px-1 font-mono">space</kbd>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* --- Defects --- */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">What&apos;s wrong with it?</h2>
          <p className="text-xs text-muted-foreground">
            Select everything that applies, or nothing if it sounds right.
          </p>
        </div>
        <div className="space-y-4">
          {TAG_GROUP_ORDER.map((groupId) => {
            const group = TAG_GROUPS[groupId];
            const groupTags = tagsInGroup(groupId);
            if (groupTags.length === 0) return null;
            return (
              <div key={groupId} className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-xs font-semibold tracking-tight">{group.label}</h3>
                  {group.blurb ? (
                    <span className="text-xs text-muted-foreground">{group.blurb}</span>
                  ) : null}
                </div>
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

      {/* --- Overall --- */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Overall quality</h2>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setOverall(n)}
              className={cn(
                "h-11 flex-1 rounded-md border text-sm font-medium transition-colors",
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

      {error ? (
        <Alert className="border-red-500/30 bg-red-500/5">
          <AlertTitle className="text-sm">Could not save that rating</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-3 pb-8">
        <Button onClick={() => void submit()} disabled={!canSubmit} size="lg">
          {submitting ? "Saving…" : index + 1 === queue.length ? "Submit & finish" : "Submit & next"}
        </Button>
        {!canSubmit && !submitting ? (
          <span className="text-xs text-muted-foreground">
            Score the clip to continue
          </span>
        ) : null}
      </div>
    </div>
  );
}
