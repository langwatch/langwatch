import type React from "react";
import { RICH_ARRIVAL_TRACE_ID } from "../data/sample-preview-traces";

/**
 * Global `<style>` tag for the rich-arrival row's tour highlight — the soft blue halo +
 * outer ring that pulses around the highlighted row.
 */
const ACTIVE_STAGES = ["auroraLanding", "postArrival", "drawerOverview"] as const;

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

  // Outer ring split across the tbody's row(s): - top stroke on every td of the first
  // row - bottom stroke on every td of the last row (same row in compact) - left/right
  // side strokes spanning ALL rows' first/last td
  const ROW_FIRST = " > tr:first-child > td";
  const ROW_LAST = " > tr:last-child > td";
  const SIDE_FIRST = " > tr > td:first-child";
  const SIDE_LAST = " > tr > td:last-child";

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
      ${each(" > tr > td")} {
        background-color: var(--rich-bg);
        transition: background-color 200ms ease, box-shadow 200ms ease;
      }
      ${each(ROW_FIRST)} {
        box-shadow: inset 0 1px 0 0 var(--rich-ring);
      }
      ${each(ROW_LAST)} {
        box-shadow: inset 0 -1px 0 0 var(--rich-ring);
      }
      ${each(SIDE_FIRST)} {
        box-shadow: inset 1px 0 0 0 var(--rich-ring);
      }
      ${each(SIDE_LAST)} {
        box-shadow: inset -1px 0 0 0 var(--rich-ring);
      }
      ${each(" > tr:first-child > td:first-child")} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring),
          inset 1px 0 0 0 var(--rich-ring);
      }
      ${each(" > tr:first-child > td:last-child")} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring),
          inset -1px 0 0 0 var(--rich-ring);
      }
      ${each(" > tr:last-child > td:first-child")} {
        box-shadow:
          inset 0 -1px 0 0 var(--rich-ring),
          inset 1px 0 0 0 var(--rich-ring);
      }
      ${each(" > tr:last-child > td:last-child")} {
        box-shadow:
          inset 0 -1px 0 0 var(--rich-ring),
          inset -1px 0 0 0 var(--rich-ring);
      }
      ${each(" > tr:first-child:last-child > td:first-child")} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring),
          inset 0 -1px 0 0 var(--rich-ring),
          inset 1px 0 0 0 var(--rich-ring);
      }
      ${each(" > tr:first-child:last-child > td:last-child")} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring),
          inset 0 -1px 0 0 var(--rich-ring),
          inset -1px 0 0 0 var(--rich-ring);
      }
      ${each(" > tr > td", { hover: true })} {
        background-color: var(--rich-bg-hover);
      }
      ${each(ROW_FIRST, { hover: true })} {
        box-shadow: inset 0 1px 0 0 var(--rich-ring-hover);
      }
      ${each(ROW_LAST, { hover: true })} {
        box-shadow: inset 0 -1px 0 0 var(--rich-ring-hover);
      }
      ${each(SIDE_FIRST, { hover: true })} {
        box-shadow: inset 1px 0 0 0 var(--rich-ring-hover);
      }
      ${each(SIDE_LAST, { hover: true })} {
        box-shadow: inset -1px 0 0 0 var(--rich-ring-hover);
      }
      ${each(" > tr:first-child > td:first-child", { hover: true })} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring-hover),
          inset 1px 0 0 0 var(--rich-ring-hover);
      }
      ${each(" > tr:first-child > td:last-child", { hover: true })} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring-hover),
          inset -1px 0 0 0 var(--rich-ring-hover);
      }
      ${each(" > tr:last-child > td:first-child", { hover: true })} {
        box-shadow:
          inset 0 -1px 0 0 var(--rich-ring-hover),
          inset 1px 0 0 0 var(--rich-ring-hover);
      }
      ${each(" > tr:last-child > td:last-child", { hover: true })} {
        box-shadow:
          inset 0 -1px 0 0 var(--rich-ring-hover),
          inset -1px 0 0 0 var(--rich-ring-hover);
      }
      ${each(" > tr:first-child:last-child > td:first-child", { hover: true })} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring-hover),
          inset 0 -1px 0 0 var(--rich-ring-hover),
          inset 1px 0 0 0 var(--rich-ring-hover);
      }
      ${each(" > tr:first-child:last-child > td:last-child", { hover: true })} {
        box-shadow:
          inset 0 1px 0 0 var(--rich-ring-hover),
          inset 0 -1px 0 0 var(--rich-ring-hover),
          inset -1px 0 0 0 var(--rich-ring-hover);
      }
    `}</style>
  );
};
