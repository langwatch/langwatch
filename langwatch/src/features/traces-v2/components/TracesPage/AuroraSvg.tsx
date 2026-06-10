import type React from "react";

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 360;

/**
 * Hot core anchored above the bar's vertical centre so the brightest point
 * sits near (or above) the visible top edge — only the lower drape of each
 * curtain peeks into the page.
 */
const CURTAIN_CY = VIEWBOX_HEIGHT * 0.22;

interface Curtain {
  cx: number;
  rx: number;
  ry: number;
  /**
   * Decorative aurora gradient stops: sky/blue/cyan/indigo hex values that
   * have no semantic equivalent in the Chakra theme.
   */
  color: string;
  durationMs: number;
  delayMs: number;
  reverse?: boolean;
}

/**
 * Curtains are packed tighter than their radii so they overlap, and
 * mix-blend-mode "screen" (below) brightens those overlaps additively —
 * making the row read as one continuous wash instead of discrete blobs.
 * Mismatched durations with negative delays keep them out of phase so
 * there's no perceptible resync beat. Cycle times sit in the 4–7s range
 * so the ribbon reads as something happening *now*, not as a slow
 * background loop. Delays are scaled in proportion so each curtain
 * still enters its cycle at a different phase.
 */
const CURTAINS: Curtain[] = [
  {
    cx: 50,
    rx: 170,
    ry: 270,
    color: "#7dd3fc",
    durationMs: 5750,
    delayMs: -1100,
  },
  {
    cx: 160,
    rx: 160,
    ry: 290,
    color: "#3b82f6",
    durationMs: 4500,
    delayMs: -2750,
    reverse: true,
  },
  {
    cx: 270,
    rx: 175,
    ry: 260,
    color: "#22d3ee",
    durationMs: 6500,
    delayMs: -750,
  },
  {
    cx: 380,
    rx: 165,
    ry: 295,
    color: "#60a5fa",
    durationMs: 4250,
    delayMs: -3500,
    reverse: true,
  },
  {
    cx: 490,
    rx: 175,
    ry: 270,
    color: "#6366f1",
    durationMs: 6000,
    delayMs: -1750,
  },
  {
    cx: 600,
    rx: 160,
    ry: 285,
    color: "#38bdf8",
    durationMs: 5000,
    delayMs: -4250,
    reverse: true,
  },
  {
    cx: 710,
    rx: 170,
    ry: 265,
    color: "#818cf8",
    durationMs: 5750,
    delayMs: -1400,
  },
  {
    cx: 820,
    rx: 165,
    ry: 290,
    color: "#0ea5e9",
    durationMs: 4750,
    delayMs: -3100,
    reverse: true,
  },
  {
    cx: 940,
    rx: 175,
    ry: 275,
    color: "#a5b4fc",
    durationMs: 6750,
    delayMs: -2200,
  },
];

const gradientId = (index: number, suffix: string) =>
  `tracesV2Aurora${suffix}${index}`;

interface AuroraSvgProps {
  /** Suffix appended to gradient IDs so multiple instances on a page don't collide. */
  idSuffix?: string;
}

export const AuroraSvg: React.FC<AuroraSvgProps> = ({ idSuffix = "" }) => (
  <svg
    viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
    preserveAspectRatio="none"
    style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      filter: "blur(11px)",
    }}
  >
    <defs>
      {CURTAINS.map((curtain, i) => (
        <radialGradient
          key={gradientId(i, idSuffix)}
          id={gradientId(i, idSuffix)}
          cx="50%"
          cy="22%"
          r="65%"
        >
          <stop offset="0%" stopColor={curtain.color} stopOpacity="1" />
          <stop offset="45%" stopColor={curtain.color} stopOpacity="0.55" />
          <stop offset="100%" stopColor={curtain.color} stopOpacity="0" />
        </radialGradient>
      ))}
    </defs>

    {CURTAINS.map((curtain, i) => (
      <CurtainEllipse
        key={gradientId(i, idSuffix)}
        curtain={curtain}
        gradientId={gradientId(i, idSuffix)}
      />
    ))}

    <style>{`
      @keyframes tracesV2AuroraDrift {
        0%   { transform: translate(-80px, 16px)  skewX(-12deg) scaleY(0.65); opacity: 0.35; }
        22%  { transform: translate(-28px, -10px) skewX(-4deg)  scaleY(1.05); opacity: 0.85; }
        50%  { transform: translate(30px, -28px)  skewX(6deg)   scaleY(1.32); opacity: 1.0;  }
        78%  { transform: translate(70px, -8px)   skewX(11deg)  scaleY(0.95); opacity: 0.8;  }
        100% { transform: translate(90px, 20px)   skewX(8deg)   scaleY(0.78); opacity: 0.45; }
      }
      /*
       * Aurora curtain blend mode is theme-conditional. "screen" adds light
       * over dark — perfect on dark backgrounds, but on a light background
       * it washes the curtains out to invisible white. Default to "multiply"
       * so the cyan/blue curtains tint the light surface; switch to
       * "screen" only when html.dark is set (Chakra v3's class-based
       * color-mode toggle). Keeps the same curtain definitions usable in
       * both themes without a separate palette per mode.
       */
      .tracesV2-aurora-curtain { mix-blend-mode: multiply; }
      html.dark .tracesV2-aurora-curtain { mix-blend-mode: screen; }
    `}</style>
  </svg>
);

const CurtainEllipse: React.FC<{ curtain: Curtain; gradientId: string }> = ({
  curtain,
  gradientId,
}) => {
  const direction = curtain.reverse ? "alternate-reverse" : "alternate";

  return (
    <ellipse
      className="tracesV2-aurora-curtain"
      cx={curtain.cx}
      cy={CURTAIN_CY}
      rx={curtain.rx}
      ry={curtain.ry}
      fill={`url(#${gradientId})`}
      style={{
        transformBox: "fill-box",
        transformOrigin: "center",
        // mix-blend-mode lives in the stylesheet so it can switch between
        // "multiply" (light mode) and "screen" (dark mode).
        animation: `tracesV2AuroraDrift ${curtain.durationMs}ms ease-in-out ${curtain.delayMs}ms infinite ${direction}`,
        willChange: "transform, opacity",
      }}
    />
  );
};
