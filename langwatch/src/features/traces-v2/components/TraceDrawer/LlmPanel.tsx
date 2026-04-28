import { Box, Flex, HStack, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
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
} from "./markdownView";

interface LlmPanelProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
}

/**
 * The LLM summary tab. Renders the trace as proper markdown (so quoted email
 * threads, lists, and tables read naturally) while Copy still hands back the
 * raw markdown source — the rendered view is for humans, the clipboard is
 * for the next LLM.
 */
const LLM_PANEL_DEFAULT: MarkdownConfig = {
  ...DEFAULT_MARKDOWN_CONFIG,
  includeSpanIO: true,
  includeSpanAttributes: true,
};

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

  return (
    <Flex direction="column" minHeight="full">
      {/* Top bar — Configure + Copy live up here so they're reachable at a
          glance instead of buried at the bottom of a long markdown dump. */}
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
        flex={1}
        // `minH=0` lets the flex child actually shrink instead of pushing
        // the parent past its bounds — the previous layout was producing
        // a few stray pixels of overflow that turned every scroll tick
        // into a juddery 5px wiggle.
        minHeight={0}
        overflow="auto"
        bg="bg.panel"
      >
        <RenderedMarkdown markdown={markdown} paddingX={4} paddingY={3} />
      </Box>
    </Flex>
  );
}
