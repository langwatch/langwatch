/** A branded feature's illustrations, drawn inline with colour only from tokens. */
import { chakra } from "@chakra-ui/react";
import { useId } from "react";

import {
  BRAIDS_ART_CROSSINGS,
  BRAIDS_ART_DIVIDER_PATH,
  BRAIDS_ART_LOCK_SHACKLE_PATH,
  BRAIDS_ART_PROJECT_ROWS,
  BRAIDS_ART_SPANS,
  BRAIDS_ART_STRAND_ENDS,
  BRAIDS_ART_STRANDS,
  BRAIDS_EMPTY_DIVIDER_PATH,
  BRAIDS_EMPTY_PLUS_PATH,
  BRAIDS_EMPTY_PROJECT_ROWS,
  BRAIDS_EMPTY_SPAN_ROWS,
  BRAIDS_EMPTY_STRANDS,
} from "./braids-paths.ts";
import { type FeatureName, svgIdBase } from "./feature-brands.ts";
import { colorModeClass, type LogoColorMode } from "./logo-icon.tsx";

export type FeatureIllustrationName = "empty-state" | "enterprise";

export interface FeatureIllustrationProps {
  feature: FeatureName;
  name: FeatureIllustrationName;
  forceColorMode?: LogoColorMode;
}

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
const CANVAS_HEIGHTS: Record<FeatureIllustrationName, number> = {
  "empty-state": 300,
  enterprise: 256,
};
const CANVAS_HEIGHT = CANVAS_HEIGHTS.enterprise;

/** The empty state's projects, as the app's project badge draws them: two letters on a square. */
const EMPTY_PROJECTS = [
  { initials: "WO", name: "Web orchestrator" },
  { initials: "SA", name: "Specialist agents" },
  { initials: "SE", name: "Search agent" },
] as const;

const SUMMARY: Record<FeatureIllustrationName, string> = {
  "empty-state": "One trace, three projects",
  enterprise: "One trace across your organisation",
};

const project = (index: number) => `feature.braids.project.${index}`;
const projectInk = (index: number) => `feature.braids.projectInk.${index}`;

/** The Enterprise art's project: a round avatar with its first letter, then its name. */
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

type MaskId = (index: number) => string;

/** Cuts the gap at every crossing where this project's strand passes under another. */
function UnderMask({ index, maskId }: { index: number; maskId: MaskId }) {
  return (
    <mask
      id={maskId(index)}
      maskUnits="userSpaceOnUse"
      x="0"
      y="0"
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
    >
      {/* Mask luminance, not paint: white keeps, black cuts the gap. */}
      <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="white" />
      {BRAIDS_ART_CROSSINGS.filter((crossing) => crossing.under === index).map((crossing) => (
        <path key={crossing.d} d={crossing.d} fill="none" stroke="black" strokeWidth={STRAND_GAP} />
      ))}
    </mask>
  );
}

function ArtStrand({ index, maskId }: { index: number; maskId: MaskId }) {
  return (
    <chakra.path
      d={BRAIDS_ART_STRANDS[index - 1]}
      fill="none"
      stroke={project(index)}
      strokeWidth={STRAND_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      mask={`url(#${maskId(index)})`}
      data-strand={index}
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

function ArtSpan({ index }: { index: number }) {
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

function EmptyProjectChip({ index }: { index: number }) {
  const { initials, name } = EMPTY_PROJECTS[index - 1] ?? EMPTY_PROJECTS[0];
  const centre = BRAIDS_EMPTY_PROJECT_ROWS[index - 1] ?? 0;
  return (
    <g data-project={index}>
      <chakra.rect
        x={28.5}
        y={centre - 22.5}
        width={178}
        height={45}
        rx={10}
        fill="bg.panel"
        stroke="border"
      />
      <chakra.rect
        x={38}
        y={centre - 13}
        width={27}
        height={27}
        rx={7}
        fill={project(index)}
        data-badge={index}
      />
      <chakra.text
        x={51.5}
        y={centre + 4.5}
        textAnchor="middle"
        fontSize="9px"
        fontWeight="600"
        fill={projectInk(index)}
      >
        {initials}
      </chakra.text>
      <chakra.text x={75} y={centre + 4.5} fontSize="12px" fill="fg">
        {name}
      </chakra.text>
    </g>
  );
}

/** Dotted: these projects are not braided yet. A strand passing under another keeps a gap. */
function EmptyStrand({ index, maskId }: { index: number; maskId: MaskId }) {
  const strand = BRAIDS_EMPTY_STRANDS[index - 1];
  if (!strand) return null;
  return (
    <chakra.path
      d={strand.d}
      fill="none"
      stroke={project(index)}
      strokeWidth={STRAND_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="2 8"
      mask={"under" in strand ? `url(#${maskId(index)})` : undefined}
      data-strand={index}
    />
  );
}

function EmptyUnderMask({ index, maskId }: { index: number; maskId: MaskId }) {
  const strand = BRAIDS_EMPTY_STRANDS[index - 1];
  if (!strand || !("under" in strand)) return null;
  const over = BRAIDS_EMPTY_STRANDS[strand.under - 1];
  return (
    <mask
      id={maskId(index)}
      maskUnits="userSpaceOnUse"
      x="0"
      y="0"
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHTS["empty-state"]}
    >
      <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHTS["empty-state"]} fill="white" />
      <path d={over?.d} fill="none" stroke="black" strokeWidth={STRAND_GAP + 2} />
    </mask>
  );
}

/** The empty state: projects not yet braided, and an empty trace with a "+" where one starts. */
function BraidsEmptyArt({ idBase }: { idBase: string }) {
  const maskId: MaskId = (index) => `${idBase}-empty-under-${index}`;
  return (
    <>
      <defs>
        {STRAND_INDEXES.map((index) => (
          <EmptyUnderMask key={index} index={index} maskId={maskId} />
        ))}
      </defs>
      <chakra.text x={28} y={34} fontSize="12px" fill="fg.muted">
        Your projects
      </chakra.text>
      <chakra.text x={500} y={34} fontSize="12px" fill="fg.muted">
        A shared trace starts here
      </chakra.text>
      {STRAND_INDEXES.map((index) => (
        <EmptyProjectChip key={index} index={index} />
      ))}
      {STRAND_INDEXES.map((index) => (
        <EmptyStrand key={index} index={index} maskId={maskId} />
      ))}
      <chakra.rect
        x={492.5}
        y={60.5}
        width={239}
        height={226}
        rx={12}
        fill="bg.subtle"
        stroke="border"
      />
      <chakra.text x={508} y={85} fontSize="13px" fontWeight="600" fill="fg">
        handle_message
      </chakra.text>
      <chakra.path d={BRAIDS_EMPTY_DIVIDER_PATH} stroke="border" strokeWidth={1} />
      {BRAIDS_EMPTY_SPAN_ROWS.map((row) => (
        <chakra.rect
          key={row.y}
          x={row.x + 0.5}
          y={row.y + 0.5}
          width={row.width}
          height={11}
          rx={4}
          fill="none"
          stroke="border"
          data-span-row
        />
      ))}
      <chakra.circle cx={612} cy={175} r={23} fill="bg.panel" stroke="border" data-target />
      <chakra.path
        d={BRAIDS_EMPTY_PLUS_PATH}
        fill="none"
        stroke="fg.muted"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  );
}

function BraidsArt({ name, idBase }: { name: FeatureIllustrationName; idBase: string }) {
  if (name === "empty-state") return <BraidsEmptyArt idBase={idBase} />;
  const maskId: MaskId = (index) => `${idBase}-under-${index}`;
  return (
    <>
      <defs>
        {STRAND_INDEXES.map((index) => (
          <UnderMask key={index} index={index} maskId={maskId} />
        ))}
      </defs>
      {STRAND_INDEXES.map((index) => (
        <ProjectChip key={index} index={index} />
      ))}
      {STRAND_INDEXES.map((index) => (
        <ArtStrand key={index} index={index} maskId={maskId} />
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
        {SUMMARY[name]}
      </chakra.text>
      <chakra.path d={BRAIDS_ART_DIVIDER_PATH} stroke="border" strokeWidth={1} />
      {BRAIDS_ART_SPANS.map((span, index) => (
        <ArtSpan key={`${span.x}-${span.y}`} index={index} />
      ))}
      {STRAND_INDEXES.map((index) => (
        <StrandEnds key={index} index={index} />
      ))}
      {name === "enterprise" ? <SignedCallsPill /> : null}
    </>
  );
}

/** Each feature's art; a new branded feature adds its set here. */
const ART: Record<FeatureName, typeof BraidsArt> = { braids: BraidsArt };

/** Decorative: the page copy beside it carries the meaning, so the art is hidden from readers. */
export function FeatureIllustration({ feature, name, forceColorMode }: FeatureIllustrationProps) {
  const idBase = svgIdBase(useId());
  const Art = ART[feature];
  return (
    <chakra.svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHTS[name]}`}
      width="100%"
      height="auto"
      maxWidth="760px"
      fontFamily="body"
      aria-hidden="true"
      className={colorModeClass(forceColorMode)}
      data-feature={feature}
      data-illustration={name}
    >
      <Art name={name} idBase={idBase} />
    </chakra.svg>
  );
}
