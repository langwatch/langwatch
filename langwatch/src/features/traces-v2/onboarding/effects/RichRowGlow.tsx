import type React from "react";
import { RICH_ARRIVAL_TRACE_ID } from "../data/samplePreviewTraces";

/**
 * Global `<style>` tag for the rich-arrival row's tour highlight —
 * the soft blue halo + inset ring that pulses around the highlighted
 * row during `postArrival`. Scoped with the same body data attribute
 * (`body[data-traces-tour-stage="postArrival"]`) that `DrawerGlow`
 * uses for the drawer-overview glow, so the rule only matches while
 * that exact stage is live and removes itself otherwise.
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
 * Uses `html.dark` for the dark-mode override (Chakra v3's
 * class-based color mode), matching `DrawerGlow`.
 */
export const RichRowGlow: React.FC = () => {
  // The selector embeds the rich trace id directly so the style
  // matches *only* the highlighted row — adjacent rows in the same
  // table stay untouched even though the body stage attribute is
  // page-wide.
  const tbodySel = `tbody[data-trace-id="${RICH_ARRIVAL_TRACE_ID}"]`;
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
      body[data-traces-tour-stage="postArrival"] ${tbodySel} {
        position: relative;
        z-index: 10;
        cursor: pointer;
        animation: tracesV2RichRowGlow 2.2s ease-in-out infinite;
        transition: filter 220ms ease;
      }
      body[data-traces-tour-stage="postArrival"] ${tbodySel} td {
        background-color: rgba(59, 130, 246, 0.08);
        box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.45);
        transition: background-color 200ms ease, box-shadow 200ms ease;
      }
      body[data-traces-tour-stage="postArrival"] ${tbodySel}:hover td {
        background-color: rgba(59, 130, 246, 0.18);
        box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.7);
      }
      html.dark body[data-traces-tour-stage="postArrival"] ${tbodySel} {
        animation: tracesV2RichRowGlowDark 2.2s ease-in-out infinite;
      }
      html.dark body[data-traces-tour-stage="postArrival"] ${tbodySel} td {
        background-color: rgba(125, 211, 252, 0.1);
        box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.32);
      }
      html.dark body[data-traces-tour-stage="postArrival"] ${tbodySel}:hover td {
        background-color: rgba(125, 211, 252, 0.2);
        box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.55);
      }
    `}</style>
  );
};
