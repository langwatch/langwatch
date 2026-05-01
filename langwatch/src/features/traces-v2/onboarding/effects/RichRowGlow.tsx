import type React from "react";
import { RICH_ARRIVAL_TRACE_ID } from "../data/samplePreviewTraces";

/**
 * Global `<style>` tag for the rich-arrival row's tour highlight —
 * the soft blue halo + outer ring that pulses around the highlighted
 * row. Active across the arrival → drawer chapters
 * (`auroraArrival`, `postArrival`, `drawerOverview`) so the row
 * "comes out glowing" the moment it lands and stays visibly tagged
 * while the drawer is open.
 *
 * Why a global stylesheet (not a Chakra `css` prop on a wrapper):
 * the table renders inside the always-on `ResultsPane` chrome, and
 * the row glow is conceptually owned by the onboarding journey, not
 * by the page chrome. Mounting the rule from inside the onboarding
 * module means the chrome doesn't have to know about
 * `RICH_ARRIVAL_TRACE_ID` at all, and lazy-mount discipline
 * (`OnboardingHost` only renders this when active) keeps the rule
 * out of stylesheet for users who aren't onboarding.
 *
 * Scoped to `> tr:first-child > td` so only the main row gets the
 * outer ring — the optional IOPreview addon row inside the same
 * `<tbody>` would otherwise pick up its own ring and the trace
 * would read as two stacked highlighted cells.
 *
 * Uses `html.dark` for the dark-mode override (Chakra v3's
 * class-based color mode), matching `DrawerGlow`.
 */
const ACTIVE_STAGES = [
  "auroraArrival",
  "postArrival",
  "drawerOverview",
] as const;

export const RichRowGlow: React.FC = () => {
  const tbody = `tbody[data-trace-id="${RICH_ARRIVAL_TRACE_ID}"]`;

  // Build a comma-separated selector list. Each rule needs to match
  // the row under any of the three active stages, and CSS doesn't
  // let us factor that out — so we generate the cross-product here
  // once and pass it to every rule that needs it.
  const each = (suffix: string, opts: { hover?: boolean; dark?: boolean } = {}) =>
    ACTIVE_STAGES.map((stage) => {
      const dark = opts.dark ? "html.dark " : "";
      const hover = opts.hover ? ":hover" : "";
      return `${dark}body[data-traces-tour-stage="${stage}"] ${tbody}${hover}${suffix}`;
    }).join(", ");

  // Outer ring on the main row only. Top + bottom strokes on every
  // td; first/last td add the matching side stroke. The result reads
  // as one outlined block rather than four side-by-side boxes.
  const ROW = " > tr:first-child > td";
  const ROW_FIRST = " > tr:first-child > td:first-child";
  const ROW_LAST = " > tr:first-child > td:last-child";

  return (
    <style>{`
      @keyframes tracesV2RichRowGlow {
        0%, 100% {
          filter:
            drop-shadow(0 0 6px rgba(59, 130, 246, 0.45))
            drop-shadow(0 0 16px rgba(99, 102, 241, 0.24));
        }
        50% {
          filter:
            drop-shadow(0 0 12px rgba(59, 130, 246, 0.7))
            drop-shadow(0 0 26px rgba(99, 102, 241, 0.36));
        }
      }
      @keyframes tracesV2RichRowGlowDark {
        0%, 100% {
          filter:
            drop-shadow(0 0 8px rgba(125, 211, 252, 0.32))
            drop-shadow(0 0 20px rgba(165, 180, 252, 0.2));
        }
        50% {
          filter:
            drop-shadow(0 0 14px rgba(125, 211, 252, 0.55))
            drop-shadow(0 0 30px rgba(165, 180, 252, 0.34));
        }
      }
      ${each("")} {
        --rich-ring: rgba(59, 130, 246, 0.55);
        --rich-ring-hover: rgba(59, 130, 246, 0.78);
        --rich-bg: rgba(59, 130, 246, 0.08);
        --rich-bg-hover: rgba(59, 130, 246, 0.18);
        position: relative;
        z-index: 10;
        cursor: pointer;
        animation: tracesV2RichRowGlow 2.2s ease-in-out infinite;
        transition: filter 220ms ease;
      }
      ${each("", { dark: true })} {
        --rich-ring: rgba(125, 211, 252, 0.4);
        --rich-ring-hover: rgba(125, 211, 252, 0.62);
        --rich-bg: rgba(125, 211, 252, 0.1);
        --rich-bg-hover: rgba(125, 211, 252, 0.2);
        animation: tracesV2RichRowGlowDark 2.2s ease-in-out infinite;
      }
      ${each(ROW)} {
        background-color: var(--rich-bg);
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring),
          inset 0 -1px 0 0 var(--rich-ring);
        transition: background-color 200ms ease, box-shadow 200ms ease;
      }
      ${each(ROW_FIRST)} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring),
          inset 0 -1px 0 0 var(--rich-ring),
          inset 1px 0 0 0 var(--rich-ring);
      }
      ${each(ROW_LAST)} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring),
          inset 0 -1px 0 0 var(--rich-ring),
          inset -1px 0 0 0 var(--rich-ring);
      }
      ${each(ROW, { hover: true })} {
        background-color: var(--rich-bg-hover);
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring-hover),
          inset 0 -1px 0 0 var(--rich-ring-hover);
      }
      ${each(ROW_FIRST, { hover: true })} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring-hover),
          inset 0 -1px 0 0 var(--rich-ring-hover),
          inset 1px 0 0 0 var(--rich-ring-hover);
      }
      ${each(ROW_LAST, { hover: true })} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring-hover),
          inset 0 -1px 0 0 var(--rich-ring-hover),
          inset -1px 0 0 0 var(--rich-ring-hover);
      }
    `}</style>
  );
};
