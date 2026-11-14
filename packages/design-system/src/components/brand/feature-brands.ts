/** The branded features the design system knows: name, tagline and mark geometry. */
import { BRAIDS_MARK_SMALL, BRAIDS_MARK_STANDARD } from "./braids-paths.ts";

/** A strand's colour role; it resolves to the token `feature.<name>.<tone>`. */
export type StrandTone = "lead" | "weave";

/** One stroked strand; `under` names the strand that crosses over it and cuts its gap. */
export interface WovenStrand {
  d: string;
  tone: StrandTone;
  under?: number;
}

/** One master of a mark on a 40 by 40 canvas. */
export interface MarkMaster {
  strokeWidth: number;
  gapWidth: number;
  strands: readonly WovenStrand[];
}

export interface FeatureBrand {
  name: string;
  tagline: string;
  mark: { standard: MarkMaster; small: MarkMaster };
}

/** At or below this many pixels a mark draws its small master. */
export const SMALL_MASTER_MAX_SIZE = 24;

export const FEATURE_BRANDS = {
  braids: {
    name: "Braids",
    tagline: "One trace. Every project.",
    mark: { standard: BRAIDS_MARK_STANDARD, small: BRAIDS_MARK_SMALL },
  },
} satisfies Record<string, FeatureBrand>;

export type FeatureName = keyof typeof FEATURE_BRANDS;

export const FEATURE_NAMES: readonly FeatureName[] = ["braids"];

/** A per-instance SVG id base: React's useId with the characters url(#...) rejects removed. */
export function svgIdBase(reactId: string): string {
  return `fb${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}
