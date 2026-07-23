"use client";

import { useState } from "react";
import {
  PRONUNCIATION_KINDS,
  WORD_ISSUES,
  type WordFlag,
  type WordIssue,
} from "@/lib/annotation";
import { cn } from "@/lib/utils";

/**
 * Click-the-word annotation.
 *
 * Words render as generously padded pills rather than inline text: inline words are
 * ~8px tall and impossible to hit on a phone. Tapping opens a small menu; picking
 * "Pronunciation" reveals a second level asking what kind of word broke, because
 * "mispronounced Eldergrove" is actionable and "pronunciation issue somewhere" is not.
 */
export function WordTagger({
  text,
  flags,
  onChange,
  disputedIndices,
}: {
  text: string;
  flags: WordFlag[];
  onChange: (flags: WordFlag[]) => void;
  /** Optional: words the recogniser disagreed about, shown as a subtle hint only. */
  disputedIndices?: number[];
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const [open, setOpen] = useState<number | null>(null);
  const [pronOpen, setPronOpen] = useState(false);

  const flagFor = (i: number) => flags.find((f) => f.index === i);

  const setFlag = (index: number, word: string, issue: WordIssue, kind?: string) => {
    const next = flags.filter((f) => f.index !== index);
    next.push({ index, word, issue, ...(kind ? { kind } : {}) });
    onChange(next.sort((a, b) => a.index - b.index));
  };

  const clearFlag = (index: number) => {
    onChange(flags.filter((f) => f.index !== index));
    setOpen(null);
    setPronOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {words.map((w, i) => {
          const f = flagFor(i);
          const isOpen = open === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                setOpen(isOpen ? null : i);
                setPronOpen(false);
              }}
              className={cn(
                // Every word carries a visible border and a faint fill so it reads as a
                // tappable chip, not prose. Before this they were borderless until hover,
                // and reviewers did not realise the words themselves were the control.
                "rounded-md border px-2.5 py-1.5 text-base leading-tight transition-colors",
                f
                  ? "border-amber-500 bg-amber-500/15 font-medium"
                  : isOpen
                    ? "border-foreground bg-muted"
                    : "border-border bg-muted/40 hover:border-foreground hover:bg-muted",
                // Recogniser disagreement is a hint, never a verdict: the reviewer is
                // judging the audio, and the transcript is our instrument, not truth.
                !f && disputedIndices?.includes(i) && "border-dashed border-muted-foreground/50",
              )}
            >
              {w}
              {f ? (
                <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  {f.kind ?? f.issue.replace("_", " ")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {open !== null ? (
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-sm font-medium">“{words[open]}”</span>
            <button
              type="button"
              onClick={() => {
                setOpen(null);
                setPronOpen(false);
              }}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>

          {!pronOpen ? (
            <div className="flex flex-wrap gap-2">
              {WORD_ISSUES.map((issue) => {
                const active = flagFor(open)?.issue === issue.id;
                return (
                  <button
                    key={issue.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      // "Pronunciation" is a doorway to the kind submenu, not an answer
                      // in itself, so it always opens even when already chosen: a
                      // reviewer tapping it on a flagged word wants to change acronym to
                      // number, not to lose the flag. Clearing happens on the kind.
                      if (issue.id === "pronunciation") {
                        setPronOpen(true);
                        return;
                      }
                      // The other two are terminal answers, so tapping the chosen one
                      // again unflags the word: a mis-tap is undone the same way it was
                      // made, rather than sending the reviewer hunting for "Remove flag".
                      if (active) {
                        clearFlag(open);
                        return;
                      }
                      setFlag(open, words[open], issue.id);
                      setOpen(null);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "hover:bg-muted",
                    )}
                  >
                    {issue.label}
                  </button>
                );
              })}
              {flagFor(open) ? (
                <button
                  type="button"
                  onClick={() => clearFlag(open)}
                  className="rounded-full border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                >
                  Remove flag
                </button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">What kind of problem?</p>
              <div className="flex flex-wrap gap-2">
                {PRONUNCIATION_KINDS.map((k) => {
                  const active = flagFor(open)?.kind === k.id;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        if (active) {
                          clearFlag(open);
                          return;
                        }
                        setFlag(open, words[open], "pronunciation", k.id);
                        setOpen(null);
                        setPronOpen(false);
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "border-foreground bg-foreground text-background"
                          : "hover:bg-muted",
                      )}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setPronOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {flags.length === 0
            ? "Tap any word that sounded wrong. Move on if it was all fine."
            : `${flags.length} word${flags.length === 1 ? "" : "s"} flagged`}
        </span>
        {flags.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setOpen(null);
              setPronOpen(false);
            }}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Start over
          </button>
        ) : null}
      </div>
    </div>
  );
}
