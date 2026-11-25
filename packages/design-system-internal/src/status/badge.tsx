import type { ReactNode } from "react";

import { flag } from "../class-names.ts";

export type BadgeTone = "neutral" | "brand" | "ok" | "warn" | "error";

export type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  /** Mono and in its own case, for a port, a version or a slug. */
  mono?: boolean;
  title?: string;
};

export const Badge = ({ children, tone = "neutral", mono = false, title }: BadgeProps) => (
  <span className="ds-badge" data-tone={tone} data-mono={flag({ on: mono })} title={title}>
    {children}
  </span>
);
