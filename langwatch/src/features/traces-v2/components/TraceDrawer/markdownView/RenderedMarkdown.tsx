import { Box, CodeBlock, Flex, HStack, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useColorMode } from "~/components/ui/color-mode";
import type {
  SpanDetail as FullSpan,
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { SegmentedToggle } from "../SegmentedToggle";
import { buildTraceMarkdown } from "./buildTraceMarkdown";
import { buildMarkdownComponents } from "./components";
import { ShikiCodeBlock } from "./ShikiHighlight";
import { useShikiAdapter } from "./shikiAdapter";
import type { MarkdownConfig } from "./types";

interface MarkdownViewProps {
  trace: TraceHeader | null;
  spans: SpanTreeNode[];
  fullSpans?: FullSpan[];
  config: MarkdownConfig;
}

type ViewMode = "rendered" | "source";

/**
 * Reusable rendered-markdown block. Maps markdown → Chakra components so
 * typography, spacing, colors, links, tables all inherit from the theme.
 * Shiki handles fenced code blocks. Wraps in a Shiki adapter provider so
 * callers don't have to.
 */
export function RenderedMarkdown({
  markdown,
  paddingX = 2,
  paddingY = 1.5,
}: {
  markdown: string;
  paddingX?: number;
  paddingY?: number;
}) {
  const { colorMode } = useColorMode();
  const shikiAdapter = useShikiAdapter(colorMode);
  const components = useMemo(
    () => buildMarkdownComponents(colorMode),
    [colorMode],
  );

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <Box paddingX={paddingX} paddingY={paddingY} color="fg">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {markdown}
        </ReactMarkdown>
      </Box>
    </CodeBlock.AdapterProvider>
  );
}

export function MarkdownView({
  trace,
  spans,
  fullSpans,
  config,
}: MarkdownViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("source");
  const { colorMode } = useColorMode();
  const shikiAdapter = useShikiAdapter(colorMode);

  const markdown = useMemo(
    () => (trace ? buildTraceMarkdown(trace, spans, config, fullSpans) : ""),
    [trace, spans, config, fullSpans],
  );

  if (!trace) {
    return (
      <Flex align="center" justify="center" height="full">
        <Text textStyle="xs" color="fg.subtle">
          No trace data
        </Text>
      </Flex>
    );
  }

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <Flex direction="column" height="full">
        <Box flex={1} overflow="auto" bg="bg.panel">
          {viewMode === "rendered" ? (
            <RenderedMarkdown markdown={markdown} />
          ) : (
            <ShikiCodeBlock
              code={markdown}
              language="markdown"
              colorMode={colorMode}
              flush
            />
          )}
        </Box>

        <HStack
          paddingX={2}
          paddingY={1}
          gap={1}
          borderTopWidth="1px"
          borderColor="border.muted"
          bg="bg.subtle"
          flexShrink={0}
          justify="flex-end"
        >
          <SegmentedToggle
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
            options={["source", "rendered"]}
          />
        </HStack>
      </Flex>
    </CodeBlock.AdapterProvider>
  );
}
