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
export const RichRowGlow: React.FC = () => {
  const tbodySel = `tbody[data-trace-id="${RICH_ARRIVAL_TRACE_ID}"]`;
  // Comma-list of body-stage selectors that should keep the row lit.
  // `auroraArrival` covers the arrival moment, `postArrival` is the
  // click-target beat, `drawerOverview` keeps the row tagged while
  // the user reads the drawer (so closing the drawer lands them on
  // the same visually marked row instead of a generic table).
  const stageScope = [
    `body[data-traces-tour-stage="auroraArrival"]`,
    `body[data-traces-tour-stage="postArrival"]`,
    `body[data-traces-tour-stage="drawerOverview"]`,
  ].join(", ");
  // Helper for hover scopes — each stage selector needs its own
  // `:hover` form because comma lists don't compose well across
  // descendant selectors.
  const stageScopeHover = [
    `body[data-traces-tour-stage="auroraArrival"] ${tbodySel}:hover`,
    `body[data-traces-tour-stage="postArrival"] ${tbodySel}:hover`,
    `body[data-traces-tour-stage="drawerOverview"] ${tbodySel}:hover`,
  ].join(", ");
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
      ${stageScope.split(", ").map((s) => `${s} ${tbodySel}`).join(", ")} {
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
      html.dark ${stageScope.split(", ").map((s) => `${s} ${tbodySel}`).join(", html.dark ")} {
        --rich-ring: rgba(125, 211, 252, 0.4);
        --rich-ring-hover: rgba(125, 211, 252, 0.62);
        --rich-bg: rgba(125, 211, 252, 0.1);
        --rich-bg-hover: rgba(125, 211, 252, 0.2);
        animation: tracesV2RichRowGlowDark 2.2s ease-in-out infinite;
      }
      /* Outer-perimeter ring on the main row only — every td gets
         top + bottom strokes, first/last td add the left/right
         strokes, so the row reads as one outlined block instead of
         a strip per cell. The `> tr:first-child` scope skips any
         IOPreview / Error addon `<Tr>` inside the same `<tbody>`. */
      ${stageScope.split(", ").map((s) => `${s} ${tbodySel} > tr:first-child > td`).join(", ")} {
        background-color: var(--rich-bg);
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring),
          inset 0 -1px 0 0 var(--rich-ring);
        transition: background-color 200ms ease, box-shadow 200ms ease;
      }
      ${stageScope.split(", ").map((s) => `${s} ${tbodySel} > tr:first-child > td:first-child`).join(", ")} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring),
          inset 0 -1px 0 0 var(--rich-ring),
          inset 1px 0 0 0 var(--rich-ring);
      }
      ${stageScope.split(", ").map((s) => `${s} ${tbodySel} > tr:first-child > td:last-child`).join(", ")} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring),
          inset 0 -1px 0 0 var(--rich-ring),
          inset -1px 0 0 0 var(--rich-ring);
      }
      ${stageScopeHover.split(", ").map((s) => `${s} > tr:first-child > td`).join(", ")} {
        background-color: var(--rich-bg-hover);
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring-hover),
          inset 0 -1px 0 0 var(--rich-ring-hover);
      }
      ${stageScopeHover.split(", ").map((s) => `${s} > tr:first-child > td:first-child`).join(", ")} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring-hover),
          inset 0 -1px 0 0 var(--rich-ring-hover),
          inset 1px 0 0 0 var(--rich-ring-hover);
      }
      ${stageScopeHover.split(", ").map((s) => `${s} > tr:first-child > td:last-child`).join(", ")} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring-hover),
          inset 0 -1px 0 0 var(--rich-ring-hover),
          inset -1px 0 0 0 var(--rich-ring-hover);
      }
    `}</style>
  );
};
