import { Box, Flex, HStack, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { useSpansFull } from "../../hooks/useSpansFull";
import {
  buildTraceMarkdown,
  DEFAULT_MARKDOWN_CONFIG,
  type MarkdownConfig,
  MarkdownConfigurePopover,
  MarkdownCopyButton,
  RenderedMarkdown,
  splitTraceMarkdown,
} from "./markdownView";

interface LlmPanelProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
}

/**
 * The LLM summary tab. Renders the trace as proper markdown (so quoted
 * email threads, lists, and tables read naturally) while Copy still hands
 * back the raw markdown source — the rendered view is for humans, the
 * clipboard is for the next LLM.
 *
 * The body is split at top-level `# section` headings and virtualised so
 * traces with hundreds of spans don't pay the markdown-parse + Shiki cost
 * up front for content that's never scrolled into view. Cmd+F find-in-page
 * stops working on off-screen sections; that's the well-understood cost
 * of virtualisation, and the Copy button reconstructs the full string from
 * the source data so "select all → paste" still works.
 */
const LLM_PANEL_DEFAULT: MarkdownConfig = {
  ...DEFAULT_MARKDOWN_CONFIG,
  includeSpanIO: true,
  includeSpanAttributes: true,
};

/** Px estimate per chunk before measureElement runs. Picked to overshoot
 *  rather than undershoot — undershooting causes the virtualizer to think
 *  more chunks fit in the viewport than really do, mounting extra rows on
 *  every render. */
const CHUNK_ESTIMATE_PX = 480;

export function LlmPanel({ trace, spans }: LlmPanelProps) {
  const [config, setConfig] = useState<MarkdownConfig>(LLM_PANEL_DEFAULT);

  const fullSpansQuery = useSpansFull(
    config.includeSpanAttributes || config.includeSpanIO,
  );
  const fullSpans = fullSpansQuery.data;

  const markdown = useMemo(
    () => buildTraceMarkdown(trace, spans, config, fullSpans),
    [trace, spans, config, fullSpans],
  );
  const chunks = useMemo(() => splitTraceMarkdown(markdown), [markdown]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CHUNK_ESTIMATE_PX,
    overscan: 2,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (index) => chunks[index]?.id ?? index,
  });

  return (
    <Flex direction="column" minHeight="full">
      {/* Top bar — Configure + Copy live up here so they're reachable at
          a glance instead of buried at the bottom of a long markdown
          dump. */}
      <HStack
        paddingX={3}
        paddingY={1.5}
        gap={1.5}
        borderBottomWidth="1px"
        borderColor="border.muted"
        bg="bg.subtle"
        flexShrink={0}
        justify="space-between"
        position="sticky"
        top={0}
        zIndex={1}
      >
        <Text textStyle="2xs" color="fg.subtle">
          Rendered for reading · Copy gives you the raw markdown source
        </Text>
        <HStack gap={1.5}>
          <MarkdownConfigurePopover
            config={config}
            onChange={setConfig}
            placement="bottom-end"
          />
          <MarkdownCopyButton markdown={markdown} />
        </HStack>
      </HStack>

      <Box
        ref={scrollRef}
        flex={1}
        // `minH=0` lets the flex child actually shrink instead of pushing
        // the parent past its bounds — the previous layout was producing
        // a few stray pixels of overflow that turned every scroll tick
        // into a juddery 5px wiggle.
        minHeight={0}
        overflow="auto"
        bg="bg.panel"
      >
        <Box
          height={`${virtualizer.getTotalSize()}px`}
          width="full"
          position="relative"
        >
          {virtualizer.getVirtualItems().map((row) => {
            const chunk = chunks[row.index]!;
            return (
              <Box
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                position="absolute"
                top={0}
                left={0}
                width="full"
                transform={`translateY(${row.start}px)`}
              >
                <RenderedMarkdown
                  markdown={chunk.markdown}
                  paddingX={4}
                  paddingY={3}
                />
              </Box>
            );
          })}
        </Box>
      </Box>
    </Flex>
  );
}
