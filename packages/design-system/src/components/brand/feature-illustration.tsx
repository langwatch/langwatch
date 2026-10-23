/** A branded feature's illustrations, drawn inline with colour only from tokens. */
import { chakra } from "@chakra-ui/react";
import { useId } from "react";

import { useReducedMotion } from "../../use-reduced-motion.ts";
import {
  BRAIDS_ART_DIVIDER_PATH,
  BRAIDS_ART_LOCK_SHACKLE_PATH,
  BRAIDS_ART_SPANS,
  BRAIDS_ART_STRAND_ENDS,
  BRAIDS_ART_STRANDS,
  BRAIDS_ART_UNDER,
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

const PROJECTS = [
  { initial: "W", name: "Web orchestrator" },
  { initial: "P", name: "Payments agent" },
  { initial: "S", name: "Search agent" },
] as const;

const STRAND_WIDTH = 3;
/** The gap an over strand cuts in the one beneath, as in the mark. */
const STRAND_GAP = 10;

/** An illustration with no caption ends under the trace, so the page's words follow close. */
const CANVAS_HEIGHT = { captioned: 350, bare: 304 } as const;

const COPY: Record<FeatureIllustrationName, { left: string; right: string; caption: string }> = {
  "empty-state": {
    left: "Your projects",
    right: "A shared trace starts here",
    caption: "",
  },
  enterprise: {
    left: "Across your organisation",
    right: "One trace in Web orchestrator",
    caption: "Admin-defined conditions. Optional call signing.",
  },
  hero: {
    left: "Project strands",
    right: "One trace in Web orchestrator",
    caption: "Illustrative project colours. Spans remain in their source projects.",
  },
};

const project = (index: number) => `feature.braids.project.${index}`;
const projectInk = (index: number) => `feature.braids.projectInk.${index}`;

/** A project as the app draws one: a round avatar with its first letter, then its name. */
function ProjectChip({ index, centre }: { index: number; centre: number }) {
  const { initial, name } = PROJECTS[index - 1] ?? PROJECTS[0];
  return (
    <g>
      <chakra.rect
        x={28}
        y={centre - 23}
        width={179}
        height={46}
        rx={10}
        fill="bg.panel"
        stroke="border"
      />
      <chakra.circle cx={52} cy={centre} r={12} fill={project(index)} />
      <chakra.text
        x={52}
        y={centre + 4}
        textAnchor="middle"
        fontSize="11px"
        fontWeight="600"
        fill={projectInk(index)}
      >
        {initial}
      </chakra.text>
      <chakra.text x={74} y={centre + 4} fontSize="12px" fill="fg">
        {name}
      </chakra.text>
    </g>
  );
}

type ArtState = { playing: boolean; maskId: (index: number) => string };

function ArtMask({
  index,
  over,
  maskId,
}: {
  index: number;
  over: number;
  maskId: ArtState["maskId"];
}) {
  return (
    <mask id={maskId(index)} maskUnits="userSpaceOnUse" x="200" y="60" width="300" height="220">
      {/* Mask luminance, not paint: white keeps, black cuts the gap. */}
      <rect x="200" y="60" width="300" height="220" fill="white" />
      <path
        d={BRAIDS_ART_STRANDS[over]}
        fill="none"
        stroke="black"
        strokeWidth={STRAND_GAP}
        strokeLinecap="round"
      />
    </mask>
  );
}

function ArtStrand({ index, state }: { index: number; state: ArtState }) {
  const over = BRAIDS_ART_UNDER[index];
  return (
    <chakra.path
      d={BRAIDS_ART_STRANDS[index]}
      fill="none"
      stroke={project(index + 1)}
      strokeWidth={STRAND_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={state.playing ? "1" : undefined}
      pathLength={state.playing ? 1 : undefined}
      mask={over === undefined ? undefined : `url(#${state.maskId(index)})`}
      data-strand={index + 1}
      css={state.playing ? WEAVE_IN : undefined}
      style={state.playing ? { animationDelay: `${index * 90}ms` } : undefined}
    />
  );
}

/** Where a strand meets the trace: a dot on the trace's edge, level with its span's row. */
function StrandEnd({ index }: { index: number }) {
  return (
    <chakra.circle
      cx={492}
      cy={BRAIDS_ART_STRAND_ENDS[index]}
      r={4.5}
      fill={project(index + 1)}
      stroke="bg.panel"
      strokeWidth={2}
    />
  );
}

function ArtSpan({ index, state }: { index: number; state: ArtState }) {
  const span = BRAIDS_ART_SPANS[index];
  if (!span) return null;
  return (
    <chakra.rect
      x={span.x}
      y={span.y - 6}
      width={span.width}
      height={12}
      rx={3}
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
      <chakra.rect x={286} y={270} width={173} height={39} rx={19} fill="bg.emphasized" />
      <chakra.path
        d={BRAIDS_ART_LOCK_SHACKLE_PATH}
        fill="none"
        stroke="fg"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <chakra.rect x={301} y={283} width={14} height={12} rx={2} fill="none" stroke="fg" />
      <chakra.text x={326} y={295} fontSize="10px" fill="fg">
        Signed calls, when required
      </chakra.text>
    </g>
  );
}

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
      <chakra.rect width={760} height={CANVAS_HEIGHT.captioned} rx={16} fill="bg.panel" />
      <chakra.text x={28} y={34} fontSize="12px" fill="fg.muted">
        {copy.left}
      </chakra.text>
      <chakra.text x={500} y={34} fontSize="12px" fill="fg.muted">
        {copy.right}
      </chakra.text>
      <ProjectChip index={1} centre={118} />
      <ProjectChip index={2} centre={186} />
      <ProjectChip index={3} centre={254} />
      <defs>
        {BRAIDS_ART_UNDER.map((over, index) =>
          over === undefined ? null : (
            <ArtMask key={index} index={index} over={over} maskId={state.maskId} />
          ),
        )}
      </defs>
      {BRAIDS_ART_STRANDS.map((d, index) => (
        <ArtStrand key={d} index={index} state={state} />
      ))}
      <chakra.rect
        x={492}
        y={60}
        width={240}
        height={227}
        rx={12}
        fill="bg.subtle"
        stroke="border"
      />
      <chakra.text x={508} y={85} fontSize="13px" fontWeight="600" fontFamily="mono" fill="fg">
        handle_message
      </chakra.text>
      {BRAIDS_ART_STRAND_ENDS.map((end, index) => (
        <StrandEnd key={end} index={index} />
      ))}
      <chakra.path d={BRAIDS_ART_DIVIDER_PATH} stroke="border" strokeWidth={1} />
      {BRAIDS_ART_SPANS.map((span, index) => (
        <ArtSpan key={`${span.x}-${span.y}`} index={index} state={state} />
      ))}
      {name === "enterprise" ? <SignedCallsPill /> : null}
      {copy.caption ? (
        <chakra.text x={28} y={326} fontSize="12px" fill="fg.muted">
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
      viewBox={`0 0 760 ${COPY[name].caption ? CANVAS_HEIGHT.captioned : CANVAS_HEIGHT.bare}`}
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
