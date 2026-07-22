"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Short labels keep the full nav visible on narrow screens instead of clipping the
// last item off the edge.
// The executive summary is archived: still served at /summary, no longer linked.
const LINKS = [
  { href: "/rate", label: "Annotate!", short: "Annotate!" },
  { href: "/metrics", label: "Metrics Deep Dive", short: "Metrics" },
  { href: "/samples", label: "Samples", short: "Samples" },
  { href: "/method", label: "Methodology", short: "Method" },
  { href: "/gtm", label: "Go-to-market", short: "GTM" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <nav className="relative flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] after:pointer-events-none after:sticky after:right-0 after:h-full after:w-6 after:shrink-0 after:bg-gradient-to-l after:from-background sm:gap-1 sm:after:hidden">
          {LINKS.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-colors sm:px-3",
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
