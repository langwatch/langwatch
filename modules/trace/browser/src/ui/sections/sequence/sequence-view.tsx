import { Box, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useCopyToClipboard } from "@langwatch/design-system/use-copy-to-clipboard";
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import { LuCheck, LuCopy, LuFilter, LuMaximize, LuMinus, LuPlus } from "react-icons/lu";

import { useMermaidRenderer } from "../../../behavior/sequence/use-mermaid-renderer.ts";
import { useKonamiEasterEgg } from "../../../behavior/use-konami-easter-egg.ts";
import { useViewportZoom } from "../../../behavior/use-viewport-zoom.ts";
import { generateMermaidSyntax } from "../../../model/sequence/mermaid.ts";
import { generateTopologySyntax } from "../../../model/sequence/topology-mermaid.ts";
import {
  DEFAULT_SEQUENCE_TYPES,
  SEQUENCE_SPAN_TYPES,
  type SequenceSpanType,
  type SequenceViewProps,
} from "../../../model/sequence/types.ts";

const TYPE_LABELS: Record<SequenceSpanType, string> = {
  agent: "Agents",
  llm: "LLMs",
  tool: "Tools",
  chain: "Chains",
  rag: "RAG",
  guardrail: "Guardrails",
  evaluation: "Evals",
  workflow: "Workflows",
  component: "Components",
  module: "Modules",
  server: "Server",
  client: "Client",
  producer: "Producer",
  consumer: "Consumer",
  task: "Tasks",
  span: "Generic spans",
  unknown: "Unknown",
};

// Use Mermaid's stock "default" / "dark" theme — no per-token overrides. We
// don't try to win the theming fight against Mermaid's internal style block
// any more; we just pick the right preset for the current colour mode and let
// it render natively. The Chakra-themed chrome around the diagram (toolbar,
// minimap, canvas bg) provides the LangWatch context.

function countParticipants(spans: SequenceViewProps["spans"], types: ReadonlySet<string>): number {
  const set = new Set<string>();
  for (const span of spans) {
    if (!types.has(span.type ?? "span")) continue;
    if (span.type === "tool") continue;
    const namedKey = span.type === "agent" ? `agent:${span.name}` : `other:${span.name}`;
    const key = span.type === "llm" && span.model ? `llm:${span.model}` : namedKey;
    set.add(key);
  }
  return set.size;
}

/**
 * One render shape for either diagram, so the renderer need not know which
 * syntax it draws: both fill the same id-to-span maps for click-to-select.
 */
function diagramResult({
  spans,
  selectedTypes,
  subMode,
  colorMode,
}: {
  spans: SequenceViewProps["spans"];
  selectedTypes: SequenceSpanType[];
  subMode: SequenceViewProps["subMode"];
  colorMode: "light" | "dark";
}) {
  if (subMode === "topology") {
    const r = generateTopologySyntax(spans, selectedTypes, colorMode);
    return {
      syntax: r.syntax,
      idToSpanId: r.nodeToSpanId,
      idDisplay: r.nodeDisplay,
      idKind: new Map<string, string>(r.nodes.map((node) => [node.id, node.kind])),
      primaryCount: r.nodes.length,
      secondaryCount: r.edgeCount,
      countLabel: `${r.nodes.length}n · ${r.edgeCount}e`,
    };
  }
  const r = generateMermaidSyntax(spans, selectedTypes);
  return {
    syntax: r.syntax,
    idToSpanId: r.participantToSpanId,
    idDisplay: r.participantDisplay,
    idKind: new Map<string, string>(r.participantKind),
    primaryCount: r.participants.length,
    secondaryCount: r.messageCount,
    countLabel: `${r.participants.length}p · ${r.messageCount}m`,
  };
}

/** The span types the trace has, with any type outside the list read as unknown. */
function presentTypesOf(spans: SequenceViewProps["spans"]): Set<SequenceSpanType> {
  return new Set(
    spans.map((span) => {
      const type = span.type ?? "span";
      return SEQUENCE_SPAN_TYPES.find((t) => t === type) ?? "unknown";
    }),
  );
}

function TypeFilterMenu({
  selectedTypes,
  presentTypes,
  onToggle,
}: {
  selectedTypes: SequenceSpanType[];
  presentTypes: Set<SequenceSpanType>;
  onToggle: (type: SequenceSpanType) => void;
}) {
  const selectedCount = selectedTypes.filter((t) => presentTypes.has(t)).length;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Flex
          as="button"
          align="center"
          gap={1}
          paddingX={1.5}
          paddingY={0.5}
          borderRadius="sm"
          color="fg.muted"
          cursor="pointer"
          _hover={{ bg: "bg.muted", color: "fg" }}
          transition="all 0.15s ease"
          title="Filter span types"
        >
          <Icon as={LuFilter} boxSize={3} />
          <Text textStyle="2xs" lineHeight={1} fontWeight={500}>
            {selectedCount === presentTypes.size
              ? "All types"
              : `${selectedCount}/${presentTypes.size}`}
          </Text>
        </Flex>
      </Menu.Trigger>
      <Menu.Content minWidth="200px">
        {SEQUENCE_SPAN_TYPES.map((type) => {
          const present = presentTypes.has(type);
          return (
            <Menu.CheckboxItem
              key={type}
              value={type}
              checked={selectedTypes.includes(type)}
              onCheckedChange={() => onToggle(type)}
              disabled={!present}
            >
              <Flex
                align="center"
                justify="space-between"
                width="full"
                gap={2}
                opacity={present ? 1 : 0.45}
              >
                <Text textStyle="xs">{TYPE_LABELS[type]}</Text>
                {!present ? (
                  <Text textStyle="2xs" color="fg.subtle">
                    none
                  </Text>
                ) : null}
              </Flex>
            </Menu.CheckboxItem>
          );
        })}
      </Menu.Content>
    </Menu.Root>
  );
}

function ZoomControls({
  zoom,
  zoomStep,
  onZoom,
  onFit,
  syntax,
}: {
  zoom: number;
  zoomStep: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
  syntax: string;
}) {
  return (
    <HStack gap={0.5} flexShrink={0}>
      <ZoomButton label="Zoom out" icon={LuMinus} onClick={() => onZoom(1 / zoomStep)} />
      <Tooltip content="Fit to screen" positioning={{ placement: "top" }}>
        <Box
          as="button"
          onClick={onFit}
          paddingX={1.5}
          paddingY={0.5}
          borderRadius="sm"
          color="fg.muted"
          cursor="pointer"
          _hover={{ bg: "bg.muted", color: "fg" }}
          transition="all 0.15s ease"
          minWidth="38px"
        >
          <Text textStyle="2xs" lineHeight={1} fontVariantNumeric="tabular-nums" fontWeight={500}>
            {Math.round(zoom * 100)}%
          </Text>
        </Box>
      </Tooltip>
      <ZoomButton label="Zoom in" icon={LuPlus} onClick={() => onZoom(zoomStep)} />
      <ZoomButton label="Fit to screen" icon={LuMaximize} onClick={onFit} />
      <CopySourceButton syntax={syntax} />
    </HStack>
  );
}

/** The whole diagram in miniature, with the visible area outlined; a click recentres. */
function SequenceMinimap({
  width,
  height,
  rect,
  stageRef,
  onClick,
}: {
  width: number;
  height: number;
  rect: { x: number; y: number; w: number; h: number };
  stageRef: RefObject<HTMLDivElement | null>;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <Box
      position="absolute"
      bottom={2}
      right={2}
      width={`${width}px`}
      height={`${height}px`}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.subtle"
      bg="bg.panel/85"
      backdropFilter="blur(6px)"
      boxShadow="sm"
      overflow="hidden"
      cursor="pointer"
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Box ref={stageRef} position="absolute" inset={0} />
      <Box
        position="absolute"
        top="0"
        left="0"
        borderWidth="1.5px"
        borderColor="purple.fg"
        bg="purple.subtle"
        opacity={0.4}
        pointerEvents="none"
        borderRadius="xs"
        style={{
          transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
          width: `${rect.w}px`,
          height: `${rect.h}px`,
        }}
      />
    </Box>
  );
}

export function SequenceView({ spans, selectedSpanId, onSelectSpan, subMode }: SequenceViewProps) {
  const { colorMode } = useColorMode();

  const [selectedTypes, setSelectedTypes] = useState<SequenceSpanType[]>(DEFAULT_SEQUENCE_TYPES);

  const easterEgg = useKonamiEasterEgg();

  const stageRef = useRef<HTMLDivElement>(null);
  const minimapStageRef = useRef<HTMLDivElement>(null);

  const {
    view,
    setSvgSize,
    viewportRef,
    isPanningRef,
    handleZoomBtn,
    handleResetFit,
    handleMinimapClick,
    handlePointerDown,
    handleDoubleClick,
    minimapRect,
    ZOOM_STEP,
    MINIMAP_W,
    MINIMAP_H,
  } = useViewportZoom();

  // Auto-include "span" bucket on first load if default filter would be sparse.
  const [typesFrom, setTypesFrom] = useState<typeof spans | null>(null);
  if (typesFrom !== spans) {
    setTypesFrom(spans);
    setSelectedTypes((prev) => {
      if (prev.includes("span")) return prev;
      if (countParticipants(spans, new Set<string>(prev)) > 1) return prev;
      return [...prev, "span"];
    });
  }

  const result = useMemo(
    () => diagramResult({ spans, selectedTypes, subMode, colorMode }),
    [spans, selectedTypes, subMode, colorMode],
  );
  const presentTypeSet = useMemo(() => presentTypesOf(spans), [spans]);

  const { error } = useMermaidRenderer({
    result,
    colorMode,
    easterEgg,
    onSelectSpan,
    stageRef,
    minimapStageRef,
    isPanningRef,
    setSvgSize,
    spans,
  });

  const toggleType = useCallback((type: SequenceSpanType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const hasParticipants = result.primaryCount > 0;

  return (
    <VStack align="stretch" gap={0} height="full" overflow="hidden" bg="bg">
      <Flex
        align="center"
        gap={1.5}
        paddingX={2.5}
        paddingY={1}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.subtle/60"
        flexShrink={0}
      >
        <TypeFilterMenu
          selectedTypes={selectedTypes}
          presentTypes={presentTypeSet}
          onToggle={toggleType}
        />

        <Box flex="1" />

        <ZoomControls
          zoom={view.z}
          zoomStep={ZOOM_STEP}
          onZoom={handleZoomBtn}
          onFit={handleResetFit}
          syntax={result.syntax}
        />

        <Text textStyle="2xs" color="fg.subtle" flexShrink={0} marginLeft={1.5} fontWeight={500}>
          {result.countLabel}
        </Text>
      </Flex>

      <Box
        ref={viewportRef}
        flex="1"
        overflow="hidden"
        position="relative"
        bg="bg"
        cursor={hasParticipants ? "grab" : "default"}
        onPointerDown={hasParticipants ? handlePointerDown : undefined}
        onDoubleClick={hasParticipants ? handleDoubleClick : undefined}
        css={{
          touchAction: "none",
          userSelect: "none",
          backgroundImage:
            colorMode === "dark"
              ? "radial-gradient(circle, rgba(82,82,91,0.18) 1px, transparent 1px)"
              : "radial-gradient(circle, rgba(148,163,184,0.20) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        {error ? (
          <SequenceErrorState error={error} />
        ) : (
          <SequenceStage
            hasParticipants={hasParticipants}
            selectedSpanId={selectedSpanId}
            stageRef={stageRef}
            view={view}
          />
        )}

        {hasParticipants && minimapRect ? (
          <SequenceMinimap
            width={MINIMAP_W}
            height={MINIMAP_H}
            rect={minimapRect}
            stageRef={minimapStageRef}
            onClick={handleMinimapClick}
          />
        ) : null}
      </Box>
    </VStack>
  );
}

interface ZoomButtonProps {
  label: string;
  icon: typeof LuPlus;
  onClick: () => void;
}

function CopySourceButton({ syntax }: { syntax: string }) {
  const { copied, copy } = useCopyToClipboard();
  const onClick = useCallback(() => copy(syntax), [copy, syntax]);
  return (
    <Tooltip
      content={copied ? "Copied!" : "Copy Mermaid source"}
      positioning={{ placement: "top" }}
    >
      <Flex
        as="button"
        align="center"
        justify="center"
        width="20px"
        height="20px"
        borderRadius="sm"
        color={copied ? "green.fg" : "fg.muted"}
        cursor="pointer"
        _hover={{ bg: "bg.muted", color: copied ? "green.fg" : "fg" }}
        transition="all 0.15s ease"
        onClick={onClick}
      >
        <Icon as={copied ? LuCheck : LuCopy} boxSize={2.5} />
      </Flex>
    </Tooltip>
  );
}

function ZoomButton({ label, icon, onClick }: ZoomButtonProps) {
  return (
    <Tooltip content={label} positioning={{ placement: "top" }}>
      <Flex
        as="button"
        align="center"
        justify="center"
        width="20px"
        height="20px"
        borderRadius="sm"
        color="fg.muted"
        cursor="pointer"
        _hover={{ bg: "bg.muted", color: "fg" }}
        transition="all 0.15s ease"
        onClick={onClick}
      >
        <Icon as={icon} boxSize={2.5} />
      </Flex>
    </Tooltip>
  );
}

/** Shown when mermaid refused the diagram we built. */
function SequenceErrorState({ error }: { error: string }) {
  return (
    <Flex align="center" justify="center" height="full" padding={4}>
      <VStack gap={2}>
        <Text textStyle="sm" color="fg.error">
          Could not render sequence diagram
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {error}
        </Text>
      </VStack>
    </Flex>
  );
}

/** Shown when the filters leave no span worth plotting. */
function SequenceEmptyState() {
  return (
    <Flex align="center" justify="center" height="full" padding={4} direction="column" gap={1}>
      <Text textStyle="sm" color="fg">
        No interactions to plot
      </Text>
      <Text textStyle="xs" color="fg.subtle">
        No agent, LLM, or tool spans match the current filters.
      </Text>
    </Flex>
  );
}

/** The pannable diagram surface, or the empty state when nothing plots. */
function SequenceStage({
  hasParticipants,
  selectedSpanId,
  stageRef,
  view,
}: {
  hasParticipants: boolean;
  selectedSpanId: string | null | undefined;
  stageRef: RefObject<HTMLDivElement | null>;
  view: { x: number; y: number; z: number };
}) {
  if (!hasParticipants) return <SequenceEmptyState />;

  return (
    <Box
      ref={stageRef}
      position="absolute"
      top="0"
      left="0"
      transformOrigin="0 0"
      data-selected-span-id={selectedSpanId ?? ""}
      style={{
        transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.z})`,
        willChange: "transform",
      }}
      css={{
        "& svg": { display: "block" },
      }}
    />
  );
}
