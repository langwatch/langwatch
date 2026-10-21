/** A branded feature's illustrations, drawn inline with colour only from tokens. */
import { chakra } from "@chakra-ui/react";
import { useId } from "react";

import { useReducedMotion } from "../../use-reduced-motion.ts";
import {
  BRAIDS_ART_DIVIDER_PATH,
  BRAIDS_ART_LOCK_SHACKLE_PATH,
  BRAIDS_ART_PLUS_PATH,
  BRAIDS_ART_SPANS,
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
  { initials: "WO", name: "Web orchestrator" },
  { initials: "SA", name: "Specialist agents" },
  { initials: "SE", name: "Search agent" },
] as const;

const COPY: Record<FeatureIllustrationName, { left: string; right: string; caption: string }> = {
  "empty-state": {
    left: "Your projects",
    right: "A shared trace starts here",
    caption: "Pick a target project and a matching condition.",
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

function ProjectChip({ index, y }: { index: number; y: number }) {
  const { initials, name } = PROJECTS[index - 1] ?? PROJECTS[0];
  return (
    <g>
      <chakra.rect x={28} y={y} width={179} height={46} rx={10} fill="bg.panel" stroke="border" />
      <chakra.rect x={38} y={y + 10} width={27} height={27} rx={7} fill={project(index)} />
      <chakra.text
        x={51.5}
        y={y + 28}
        textAnchor="middle"
        fontSize="9px"
        fontWeight="600"
        fill={projectInk(index)}
      >
        {initials}
      </chakra.text>
      <chakra.text x={75} y={y + 28} fontSize="12px" fill="fg">
        {name}
      </chakra.text>
    </g>
  );
}

type ArtState = { planned: boolean; playing: boolean; maskId: (index: number) => string };

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
        strokeWidth={11}
        strokeLinecap="round"
      />
    </mask>
  );
}

function strandDash({ planned, playing }: ArtState): string | undefined {
  if (planned) return "2 8";
  return playing ? "1" : undefined;
}

function ArtStrand({ index, state }: { index: number; state: ArtState }) {
  const over = BRAIDS_ART_UNDER[index];
  const cut = !state.planned && over !== undefined;
  return (
    <chakra.path
      d={BRAIDS_ART_STRANDS[index]}
      fill="none"
      stroke={project(index + 1)}
      strokeWidth={state.planned ? 3 : 5}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={strandDash(state)}
      pathLength={state.playing ? 1 : undefined}
      mask={cut ? `url(#${state.maskId(index)})` : undefined}
      data-strand={index + 1}
      css={state.playing ? WEAVE_IN : undefined}
      style={state.playing ? { animationDelay: `${index * 90}ms` } : undefined}
    />
  );
}

function ArtSpan({ index, state }: { index: number; state: ArtState }) {
  const span = BRAIDS_ART_SPANS[index];
  if (!span) return null;
  const labelled = !state.planned && index < BRAIDS_ART_SPANS.length - 1;
  return (
    <g>
      <chakra.rect
        x={span.x}
        y={span.y}
        width={span.width}
        height={12}
        rx={4}
        fill={state.planned ? "transparent" : project(span.project)}
        stroke={state.planned ? "border" : undefined}
        data-span={span.project}
        css={state.playing ? SPAN_IN : undefined}
        style={state.playing ? { animationDelay: `${520 + index * 70}ms` } : undefined}
      />
      {labelled ? (
        <chakra.text x={span.x + 4} y={span.y + 29} fontSize="9px" fill="fg.muted">
          {PROJECTS[span.project - 1]?.initials}
        </chakra.text>
      ) : null}
    </g>
  );
}

function AddSpanButton() {
  return (
    <g>
      <chakra.circle cx={612} cy={175} r={23} fill="bg.panel" stroke="border" />
      <chakra.path
        d={BRAIDS_ART_PLUS_PATH}
        fill="none"
        stroke="fg.muted"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </g>
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
    planned: name === "empty-state",
    playing,
    maskId: (index) => `${idBase}-under-${index}`,
  };
  return (
    <>
      <chakra.rect width={760} height={350} rx={16} fill="bg.panel" />
      <chakra.text x={28} y={34} fontSize="12px" fill="fg.muted">
        {copy.left}
      </chakra.text>
      <chakra.text x={500} y={34} fontSize="12px" fill="fg.muted">
        {copy.right}
      </chakra.text>
      <ProjectChip index={1} y={79} />
      <ProjectChip index={2} y={153} />
      <ProjectChip index={3} y={227} />
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
      <chakra.path d={BRAIDS_ART_DIVIDER_PATH} stroke="border" strokeWidth={1} />
      {BRAIDS_ART_SPANS.map((span, index) => (
        <ArtSpan key={`${span.x}-${span.y}`} index={index} state={state} />
      ))}
      {state.planned ? <AddSpanButton /> : null}
      {name === "enterprise" ? <SignedCallsPill /> : null}
      <chakra.text x={28} y={326} fontSize="12px" fill="fg.muted">
        {copy.caption}
      </chakra.text>
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
      viewBox="0 0 760 350"
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
