import { Box, CodeBlock, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuCode, LuEye } from "react-icons/lu";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useColorMode } from "~/components/ui/color-mode";
import { Tooltip } from "~/components/ui/tooltip";
import type {
  SpanDetail as FullSpan,
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
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
          paddingX={3}
          paddingY={1.5}
          gap={2}
          borderTopWidth="1px"
          borderColor="border.muted"
          bg="bg.subtle"
          flexShrink={0}
          justify="flex-end"
          align="center"
        >
          <Text
            textStyle="xs"
            fontWeight="medium"
            color="fg.muted"
            letterSpacing="0.005em"
          >
            Markdown
          </Text>
          <ViewModeIcon
            mode="rendered"
            label="Rendered"
            shortcut="Toggle to rendered view"
            icon={LuEye}
            active={viewMode === "rendered"}
            onClick={() => setViewMode("rendered")}
          />
          <ViewModeIcon
            mode="source"
            label="Source"
            shortcut="Toggle to source view"
            icon={LuCode}
            active={viewMode === "source"}
            onClick={() => setViewMode("source")}
          />
        </HStack>
      </Flex>
    </CodeBlock.AdapterProvider>
  );
}

interface ViewModeIconProps {
  mode: ViewMode;
  label: string;
  shortcut: string;
  icon: typeof LuEye;
  active: boolean;
  onClick: () => void;
}

/**
 * One of the two trailing view-mode icons (rendered / source). Each is its
 * own segregated pill with its own border + background, so the pair reads
 * as two distinct affordances rather than a single segmented control.
 */
function ViewModeIcon({
  mode,
  label,
  shortcut,
  icon,
  active,
  onClick,
}: ViewModeIconProps) {
  return (
    <Tooltip content={shortcut} positioning={{ placement: "top" }}>
      <Box
        as="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        data-mode={mode}
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        width="26px"
        height="26px"
        borderRadius="sm"
        borderWidth="1px"
        borderColor={active ? "blue.solid/30" : "border.muted"}
        bg={active ? "blue.solid/10" : "bg.panel"}
        color={active ? "blue.fg" : "fg.subtle"}
        cursor="pointer"
        transition="background 0.12s ease, color 0.12s ease, border-color 0.12s ease"
        _hover={
          active
            ? { bg: "blue.solid/14" }
            : { color: "fg", bg: "bg.muted", borderColor: "border" }
        }
      >
        <Icon as={icon} boxSize={3.5} />
      </Box>
    </Tooltip>
  );
}
