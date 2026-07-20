"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Short labels keep the full nav visible on narrow screens instead of clipping the
// last item off the edge.
const LINKS = [
  { href: "/", label: "Executive summary", short: "Summary" },
  { href: "/rate", label: "Annotate!", short: "Annotate!" },
  { href: "/samples", label: "Samples", short: "Samples" },
  { href: "/metrics", label: "Metrics Deep Dive", short: "Metrics" },
  { href: "/method", label: "Methodology", short: "Method" },
  { href: "/gtm", label: "Go-to-market", short: "GTM" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-foreground text-background text-[11px] font-bold">
            S
          </span>
          <span className="font-semibold tracking-tight">Soundcheck</span>
        </Link>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                <span className="hidden lg:inline">{l.label}</span>
                <span className="lg:hidden">{l.short}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
