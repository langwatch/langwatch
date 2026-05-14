import { Box, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCheck,
  LuCopy,
  LuFilter,
  LuMaximize,
  LuMinus,
  LuPlus,
} from "react-icons/lu";
import { useColorMode } from "~/components/ui/color-mode";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { generateMermaidSyntax } from "./mermaid";
import { generateTopologySyntax } from "./topologyMermaid";
import {
  DEFAULT_SEQUENCE_TYPES,
  SEQUENCE_SPAN_TYPES,
  type SequenceSpanType,
  type SequenceViewProps,
} from "./types";
import { useKonamiEasterEgg } from "./useKonamiEasterEgg";
import { useMermaidRenderer } from "./useMermaidRenderer";
import { useViewportZoom } from "./useViewportZoom";

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

function countParticipants(
  spans: SequenceViewProps["spans"],
  types: ReadonlySet<string>,
): number {
  const set = new Set<string>();
  for (const span of spans) {
    if (!types.has(span.type ?? "span")) continue;
    if (span.type === "tool") continue;
    const key =
      span.type === "llm" && span.model
        ? `llm:${span.model}`
        : span.type === "agent"
          ? `agent:${span.name}`
          : `other:${span.name}`;
    set.add(key);
  }
  return set.size;
}

export function SequenceView({
  spans,
  selectedSpanId,
  onSelectSpan,
  subMode,
}: SequenceViewProps) {
  const { colorMode } = useColorMode();

  const [selectedTypes, setSelectedTypes] = useState<SequenceSpanType[]>(
    DEFAULT_SEQUENCE_TYPES,
  );

  const easterEgg = useKonamiEasterEgg();

  const stageRef = useRef<HTMLDivElement>(null);
  const minimapStageRef = useRef<HTMLDivElement>(null);

  const {
    view,
    viewportSize,
    svgSize,
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
  useEffect(() => {
    setSelectedTypes((prev) => {
      if (prev.includes("span")) return prev;
      if (countParticipants(spans, new Set<string>(prev)) > 1) return prev;
      return [...prev, "span"];
    });
  }, [spans]);

  // Unified render result shape so the renderer doesn't have to know which
  // syntax it's drawing. Both generators populate the same id → span maps for
  // click-to-select.
  const result = useMemo(() => {
    if (subMode === "topology") {
      const r = generateTopologySyntax(spans, selectedTypes, colorMode);
      const kindMap = new Map<string, string>();
      for (const node of r.nodes) kindMap.set(node.id, node.kind);
      return {
        syntax: r.syntax,
        idToSpanId: r.nodeToSpanId,
        idDisplay: r.nodeDisplay,
        idKind: kindMap,
        primaryCount: r.nodes.length,
        secondaryCount: r.edgeCount,
        countLabel: `${r.nodes.length}n · ${r.edgeCount}e`,
      };
    }
    const r = generateMermaidSyntax(spans, selectedTypes);
    const kindMap = new Map<string, string>();
    for (const [id, kind] of r.participantKind) kindMap.set(id, kind);
    return {
      syntax: r.syntax,
      idToSpanId: r.participantToSpanId,
      idDisplay: r.participantDisplay,
      idKind: kindMap,
      primaryCount: r.participants.length,
      secondaryCount: r.messageCount,
      countLabel: `${r.participants.length}p · ${r.messageCount}m`,
    };
  }, [spans, selectedTypes, subMode, colorMode]);

  const presentTypeSet = useMemo(() => {
    const set = new Set<SequenceSpanType>();
    for (const span of spans) {
      const t = (span.type ?? "span") as SequenceSpanType;
      if (SEQUENCE_SPAN_TYPES.includes(t)) set.add(t);
      else set.add("unknown");
    }
    return set;
  }, [spans]);

  const availableSelectedCount = selectedTypes.filter((t) =>
    presentTypeSet.has(t),
  ).length;

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
                {availableSelectedCount === presentTypeSet.size
                  ? "All types"
                  : `${availableSelectedCount}/${presentTypeSet.size}`}
              </Text>
            </Flex>
          </Menu.Trigger>
          <Menu.Content minWidth="200px">
            {SEQUENCE_SPAN_TYPES.map((type) => {
              const active = selectedTypes.includes(type);
              const present = presentTypeSet.has(type);
              return (
                <Menu.CheckboxItem
                  key={type}
                  value={type}
                  checked={active}
                  onCheckedChange={() => toggleType(type)}
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

        <Box flex="1" />

        <HStack gap={0.5} flexShrink={0}>
          <ZoomButton
            label="Zoom out"
            icon={LuMinus}
            onClick={() => handleZoomBtn(1 / ZOOM_STEP)}
          />
          <Tooltip content="Fit to screen" positioning={{ placement: "top" }}>
            <Box
              as="button"
              onClick={handleResetFit}
              paddingX={1.5}
              paddingY={0.5}
              borderRadius="sm"
              color="fg.muted"
              cursor="pointer"
              _hover={{ bg: "bg.muted", color: "fg" }}
              transition="all 0.15s ease"
              minWidth="38px"
            >
              <Text
                textStyle="2xs"
                lineHeight={1}
                fontVariantNumeric="tabular-nums"
                fontWeight={500}
              >
                {Math.round(view.z * 100)}%
              </Text>
            </Box>
          </Tooltip>
          <ZoomButton
            label="Zoom in"
            icon={LuPlus}
            onClick={() => handleZoomBtn(ZOOM_STEP)}
          />
          <ZoomButton
            label="Fit to screen"
            icon={LuMaximize}
            onClick={handleResetFit}
          />
          <CopySourceButton syntax={result.syntax} />
        </HStack>

        <Text
          textStyle="2xs"
          color="fg.subtle"
          flexShrink={0}
          marginLeft={1.5}
          fontWeight={500}
        >
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
          <Flex align="center" justify="center" height="full" padding={4}>
            <VStack gap={2}>
              <Text textStyle="sm" color="fg.error">
                Could not render sequence diagram
              </Text>
              <Text textStyle="xs" color="fg.muted" fontFamily="mono">
                {error}
              </Text>
            </VStack>
          </Flex>
        ) : !hasParticipants ? (
          <Flex
            align="center"
            justify="center"
            height="full"
            padding={4}
            direction="column"
            gap={1}
          >
            <Text textStyle="sm" color="fg">
              No interactions to plot
            </Text>
            <Text textStyle="xs" color="fg.subtle">
              No agent, LLM, or tool spans match the current filters.
            </Text>
          </Flex>
        ) : (
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
        )}

        {hasParticipants && minimapRect ? (
          <Box
            position="absolute"
            bottom={2}
            right={2}
            width={`${MINIMAP_W}px`}
            height={`${MINIMAP_H}px`}
            borderRadius="md"
            borderWidth="1px"
            borderColor="border.subtle"
            bg="bg.panel/85"
            backdropFilter="blur(6px)"
            boxShadow="sm"
            overflow="hidden"
            cursor="pointer"
            onClick={handleMinimapClick}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Box ref={minimapStageRef} position="absolute" inset={0} />
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
                transform: `translate3d(${minimapRect.x}px, ${minimapRect.y}px, 0)`,
                width: `${minimapRect.w}px`,
                height: `${minimapRect.h}px`,
              }}
            />
          </Box>
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
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(() => {
    void navigator.clipboard.writeText(syntax).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [syntax]);
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
