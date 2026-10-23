/** A branded feature's illustrations, drawn inline with colour only from tokens. */
import { chakra } from "@chakra-ui/react";
import { useId } from "react";

import { useReducedMotion } from "../../use-reduced-motion.ts";
import {
  BRAIDS_ART_CROSSINGS,
  BRAIDS_ART_DIVIDER_PATH,
  BRAIDS_ART_LOCK_SHACKLE_PATH,
  BRAIDS_ART_PROJECT_ROWS,
  BRAIDS_ART_SPANS,
  BRAIDS_ART_STRAND_ENDS,
  BRAIDS_ART_STRANDS,
} from "./braids-paths.ts";
import { type FeatureName, svgIdBase } from "./feature-brands.ts";
import { colorModeClass, type LogoColorMode } from "./logo-icon.tsx";

export type FeatureIllustrationName = "empty-state" | "enterprise" | "hero";

export interface FeatureIllustrationProps {
  feature: FeatureName;
  name: FeatureIllustrationName;
  /** The hero weaves in once on mount; `false`, or a reader asking for less motion, holds it
   * still. */
  animate?: boolean;
  forceColorMode?: LogoColorMode;
}

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

const WEAVE_IN = {
  animation: `feature-weave-in 650ms ${EASE_OUT} both`,
  "@keyframes feature-weave-in": {
    from: { strokeDashoffset: 1 },
    to: { strokeDashoffset: 0 },
  },
};

const SPAN_IN = {
  transformBox: "fill-box",
  transformOrigin: "left",
  animation: `feature-span-in 360ms ${EASE_OUT} both`,
  "@keyframes feature-span-in": {
    from: { transform: "scaleX(0)", opacity: 0 },
    to: { transform: "none", opacity: 1 },
  },
};

/** The example projects, by project 1 to 3; the canvas lists them by name. */
const PROJECTS = [
  { initial: "W", name: "Web app" },
  { initial: "P", name: "Payments agent" },
  { initial: "S", name: "Search agent" },
] as const;

const STRAND_WIDTH = 3;
/** The gap an over strand cuts in the one beneath: its own width and three either side. */
const STRAND_GAP = STRAND_WIDTH + 6;

const CANVAS_WIDTH = 760;
const CANVAS_HEIGHT = { captioned: 280, bare: 256 } as const;

const COPY: Record<FeatureIllustrationName, { summary: string; caption: string }> = {
  "empty-state": { summary: "One trace, three projects", caption: "" },
  enterprise: { summary: "One trace across your organisation", caption: "" },
  hero: {
    summary: "One trace, every project",
    caption: "Illustrative projects. Spans stay in the project that sent them.",
  },
};

const project = (index: number) => `feature.braids.project.${index}`;
const projectInk = (index: number) => `feature.braids.projectInk.${index}`;

/** A project as the app draws one: a round avatar with its first letter, then its name. */
function ProjectChip({ index }: { index: number }) {
  const { initial, name } = PROJECTS[index - 1] ?? PROJECTS[0];
  const centre = BRAIDS_ART_PROJECT_ROWS[index - 1] ?? 0;
  return (
    <g>
      <chakra.rect
        x={32.5}
        y={centre - 19.5}
        width={167}
        height={39}
        rx={8}
        fill="bg.panel"
        stroke="border"
      />
      <chakra.circle cx={54} cy={centre} r={11} fill={project(index)} />
      <chakra.text
        x={54}
        y={centre + 4}
        textAnchor="middle"
        fontSize="11px"
        fontWeight="600"
        fill={projectInk(index)}
      >
        {initial}
      </chakra.text>
      <chakra.text x={74} y={centre + 4.5} fontSize="13px" fill="fg">
        {name}
      </chakra.text>
    </g>
  );
}

type ArtState = { playing: boolean; maskId: (index: number) => string };

/** Cuts the gap at every crossing where this project's strand passes under another. */
function UnderMask({ index, maskId }: { index: number; maskId: ArtState["maskId"] }) {
  return (
    <mask
      id={maskId(index)}
      maskUnits="userSpaceOnUse"
      x="0"
      y="0"
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT.captioned}
    >
      {/* Mask luminance, not paint: white keeps, black cuts the gap. */}
      <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT.captioned} fill="white" />
      {BRAIDS_ART_CROSSINGS.filter((crossing) => crossing.under === index).map((crossing) => (
        <path key={crossing.d} d={crossing.d} fill="none" stroke="black" strokeWidth={STRAND_GAP} />
      ))}
    </mask>
  );
}

function ArtStrand({ index, state }: { index: number; state: ArtState }) {
  return (
    <chakra.path
      d={BRAIDS_ART_STRANDS[index - 1]}
      fill="none"
      stroke={project(index)}
      strokeWidth={STRAND_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={state.playing ? "1" : undefined}
      pathLength={state.playing ? 1 : undefined}
      mask={`url(#${state.maskId(index)})`}
      data-strand={index}
      css={state.playing ? WEAVE_IN : undefined}
      style={state.playing ? { animationDelay: `${(index - 1) * 90}ms` } : undefined}
    />
  );
}

/** A strand's two ends: a small dot on its project and a larger one on the trace's edge. */
function StrandEnds({ index }: { index: number }) {
  return (
    <>
      <chakra.circle cx={200} cy={BRAIDS_ART_PROJECT_ROWS[index - 1]} r={3} fill={project(index)} />
      <chakra.circle cx={508} cy={BRAIDS_ART_STRAND_ENDS[index - 1]} r={4} fill={project(index)} />
    </>
  );
}

function ArtSpan({ index, state }: { index: number; state: ArtState }) {
  const span = BRAIDS_ART_SPANS[index];
  if (!span) return null;
  return (
    <chakra.rect
      x={span.x}
      y={span.y - 4}
      width={span.width}
      height={8}
      rx={4}
      fill={project(span.project)}
      data-span={span.project}
      css={state.playing ? SPAN_IN : undefined}
      style={state.playing ? { animationDelay: `${520 + index * 70}ms` } : undefined}
    />
  );
}

function SignedCallsPill() {
  return (
    <g>
      <chakra.rect
        x={304.5}
        y={214.5}
        width={103}
        height={25}
        rx={12.5}
        fill="bg.panel"
        stroke="border"
      />
      <chakra.path
        d={BRAIDS_ART_LOCK_SHACKLE_PATH}
        fill="none"
        stroke="fg.muted"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <chakra.rect x={316} y={226} width={10} height={8} rx={2} fill="fg.muted" />
      <chakra.text x={333} y={231} fontSize="11px" fill="fg.muted">
        Signed calls
      </chakra.text>
    </g>
  );
}

const STRAND_INDEXES = [1, 2, 3] as const;

function BraidsArt({
  name,
  idBase,
  playing,
}: {
  name: FeatureIllustrationName;
  idBase: string;
  playing: boolean;
}) {
  const copy = COPY[name];
  const state: ArtState = {
    playing,
    maskId: (index) => `${idBase}-under-${index}`,
  };
  return (
    <>
      <defs>
        {STRAND_INDEXES.map((index) => (
          <UnderMask key={index} index={index} maskId={state.maskId} />
        ))}
      </defs>
      {STRAND_INDEXES.map((index) => (
        <ProjectChip key={index} index={index} />
      ))}
      {STRAND_INDEXES.map((index) => (
        <ArtStrand key={index} index={index} state={state} />
      ))}
      <chakra.rect
        x={508.5}
        y={24.5}
        width={219}
        height={207}
        rx={10}
        fill="bg.subtle"
        stroke="border"
      />
      <chakra.text x={524} y={50} fontSize="13px" fontWeight="600" fill="fg">
        POST /checkout
      </chakra.text>
      <chakra.text x={524} y={67} fontSize="11px" fill="fg.muted">
        {copy.summary}
      </chakra.text>
      <chakra.path d={BRAIDS_ART_DIVIDER_PATH} stroke="border" strokeWidth={1} />
      {BRAIDS_ART_SPANS.map((span, index) => (
        <ArtSpan key={`${span.x}-${span.y}`} index={index} state={state} />
      ))}
      {STRAND_INDEXES.map((index) => (
        <StrandEnds key={index} index={index} />
      ))}
      {name === "enterprise" ? <SignedCallsPill /> : null}
      {copy.caption ? (
        <chakra.text x={32} y={262} fontSize="12px" fill="fg.muted">
          {copy.caption}
        </chakra.text>
      ) : null}
    </>
  );
}

/** Each feature's art; a new branded feature adds its set here. */
const ART: Record<FeatureName, typeof BraidsArt> = { braids: BraidsArt };

/** Decorative: the page copy beside it carries the meaning, so the art is hidden from readers. */
export function FeatureIllustration({
  feature,
  name,
  animate = true,
  forceColorMode,
}: FeatureIllustrationProps) {
  const idBase = svgIdBase(useId());
  const reduceMotion = useReducedMotion();
  const playing = name === "hero" && animate && !reduceMotion;
  const Art = ART[feature];
  return (
    <chakra.svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${CANVAS_WIDTH} ${COPY[name].caption ? CANVAS_HEIGHT.captioned : CANVAS_HEIGHT.bare}`}
      width="100%"
      height="auto"
      maxWidth="760px"
      fontFamily="body"
      aria-hidden="true"
      className={colorModeClass(forceColorMode)}
      data-feature={feature}
      data-illustration={name}
      data-motion={playing ? "play" : "still"}
    >
      <Art name={name} idBase={idBase} playing={playing} />
    </chakra.svg>
  );
}
