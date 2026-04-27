import {
  Box,
  Button,
  ClientOnly,
  CodeBlock,
  createShikiAdapter,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuCheck, LuCopy, LuSettings2 } from "react-icons/lu";
import {
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Checkbox } from "~/components/ui/checkbox";
import { Radio, RadioGroup } from "~/components/ui/radio";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HighlighterGeneric } from "shiki";
import type {
  TraceHeader,
  SpanTreeNode,
  SpanDetail as FullSpan,
} from "~/server/api/routers/tracesV2.schemas";
import { useColorMode } from "~/components/ui/color-mode";
import { formatCost, formatDuration } from "../../utils/formatters";
import { SegmentedToggle } from "./SegmentedToggle";

export type SpanScope = "none" | "ai" | "all";
export type SpanDetailLevel = "names" | "core" | "full";
export type SpanLayout = "bullets" | "tree";

export interface MarkdownConfig {
  spanScope: SpanScope;
  spanDetail: SpanDetailLevel;
  spanLayout: SpanLayout;
  includeIO: boolean;
  includeMetadata: boolean;
  includeSpanIO: boolean;
  includeSpanAttributes: boolean;
}

export const DEFAULT_MARKDOWN_CONFIG: MarkdownConfig = {
  spanScope: "ai",
  spanDetail: "core",
  spanLayout: "tree",
  includeIO: true,
  includeMetadata: false,
  includeSpanIO: false,
  includeSpanAttributes: false,
};

interface MarkdownViewProps {
  trace: TraceHeader | null;
  spans: SpanTreeNode[];
  fullSpans?: FullSpan[];
  config: MarkdownConfig;
}

const AI_SPAN_TYPES = new Set(["llm", "agent", "rag", "tool", "evaluation"]);

function indent(text: string, depth: number): string {
  if (depth === 0) return text;
  const pad = "  ".repeat(depth);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

export function buildTraceMarkdown(
  trace: TraceHeader,
  spans: SpanTreeNode[],
  opts: MarkdownConfig,
  fullSpans?: FullSpan[],
): string {
  const lines: string[] = [];

  lines.push(`# ${trace.rootSpanName ?? trace.name ?? trace.traceId}`);
  lines.push("");
  lines.push(`- **Trace ID:** \`${trace.traceId}\``);
  lines.push(`- **Started:** ${new Date(trace.timestamp).toISOString()}`);
  lines.push(`- **Duration:** ${formatDuration(trace.durationMs)}`);
  lines.push(`- **Status:** ${trace.status}`);
  if (trace.serviceName) lines.push(`- **Service:** ${trace.serviceName}`);
  if (trace.origin) lines.push(`- **Origin:** ${trace.origin}`);
  if (trace.userId) lines.push(`- **User:** \`${trace.userId}\``);
  if (trace.conversationId)
    lines.push(`- **Conversation:** \`${trace.conversationId}\``);
  if (trace.models.length > 0)
    lines.push(`- **Models:** ${trace.models.map((m) => `\`${m}\``).join(", ")}`);
  lines.push(
    `- **Tokens:** ${trace.inputTokens ?? "—"} in / ${
      trace.outputTokens ?? "—"
    } out (${trace.totalTokens} total${
      trace.tokensEstimated ? ", estimated" : ""
    })`,
  );
  if ((trace.totalCost ?? 0) > 0)
    lines.push(`- **Cost:** ${formatCost(trace.totalCost ?? 0)}`);
  if (trace.ttft != null)
    lines.push(`- **Time to first token:** ${formatDuration(trace.ttft)}`);
  if (trace.spanCount) lines.push(`- **Spans:** ${trace.spanCount}`);
  lines.push("");

  if (trace.status === "error" && trace.error) {
    lines.push("## Error");
    lines.push("");
    lines.push("```");
    lines.push(trace.error);
    lines.push("```");
    lines.push("");
  }

  if (opts.includeIO && trace.input) {
    lines.push("## Input");
    lines.push("");
    lines.push("```");
    lines.push(trace.input);
    lines.push("```");
    lines.push("");
  }

  if (opts.includeIO && trace.output) {
    lines.push("## Output");
    lines.push("");
    lines.push("```");
    lines.push(trace.output);
    lines.push("```");
    lines.push("");
  }

  if (opts.spanScope !== "none" && spans.length > 0) {
    const filtered =
      opts.spanScope === "all"
        ? spans
        : spans.filter((s) =>
            AI_SPAN_TYPES.has((s.type ?? "span").toLowerCase()),
          );

    if (filtered.length > 0) {
      lines.push(opts.spanScope === "all" ? "## Spans" : "## AI Spans");
      lines.push("");

      const childrenByParent = new Map<string | null, SpanTreeNode[]>();
      for (const span of filtered) {
        const arr = childrenByParent.get(span.parentSpanId) ?? [];
        arr.push(span);
        childrenByParent.set(span.parentSpanId, arr);
      }
      for (const arr of childrenByParent.values()) {
        arr.sort((a, b) => a.startTimeMs - b.startTimeMs);
      }

      const fullById = new Map<string, FullSpan>();
      for (const fs of fullSpans ?? []) fullById.set(fs.spanId, fs);

      const useTree = opts.spanLayout === "tree";

      // Render the header line (name · type · duration · model · status, etc.)
      // Tree mode lives inside a code fence, so skip markdown bold/inline-code.
      const renderHeader = (span: SpanTreeNode): string => {
        const name = useTree ? span.name : `**${span.name}**`;
        const type = useTree ? span.type ?? "span" : `\`${span.type ?? "span"}\``;
        if (opts.spanDetail === "names") {
          return `${name} (${type})`;
        }
        const headerBits = [name, type, formatDuration(span.durationMs)];
        if (span.model)
          headerBits.push(useTree ? span.model : `\`${span.model}\``);
        if (span.status === "error")
          headerBits.push(useTree ? "error" : "`error`");
        return headerBits.join(" · ");
      };

      // Render the rich body (full-detail line, attributes, I/O) for a span.
      // Each entry is one block of lines (without leading indent/prefix).
      // In tree mode, nested ``` fences are flattened to plain indented text
      // because the whole tree is wrapped in one outer fence.
      const renderSpanExtras = (span: SpanTreeNode): string[][] => {
        const blocks: string[][] = [];

        if (opts.spanDetail === "full") {
          const offsetMs = Math.max(
            0,
            Math.round(span.startTimeMs - trace.timestamp),
          );
          const idLabel = useTree
            ? `span_id: ${span.spanId.slice(0, 16)} · +${offsetMs}ms → ${formatDuration(span.durationMs)}`
            : `span_id: \`${span.spanId.slice(0, 16)}\` · +${offsetMs}ms → ${formatDuration(span.durationMs)}`;
          blocks.push([idLabel]);
        }

        const full = fullById.get(span.spanId);

        if (opts.includeSpanAttributes && full?.params) {
          const attrs = full.params as Record<string, unknown>;
          if (Object.keys(attrs).length > 0) {
            const pretty = JSON.stringify(attrs, null, 2).split("\n");
            if (useTree) {
              blocks.push(["attributes:", ...pretty]);
            } else {
              blocks.push(["attributes:", "```json", ...pretty, "```"]);
            }
          }
        }

        if (opts.includeSpanIO && full?.input) {
          const inputLines = full.input.split("\n");
          blocks.push(
            useTree
              ? ["input:", ...inputLines]
              : ["input:", "```", ...inputLines, "```"],
          );
        }
        if (opts.includeSpanIO && full?.output) {
          const outputLines = full.output.split("\n");
          blocks.push(
            useTree
              ? ["output:", ...outputLines]
              : ["output:", "```", ...outputLines, "```"],
          );
        }

        return blocks;
      };

      const seen = new Set<string>();

      // ----- Bullet (indented) layout -----
      const writeSpanBullets = (span: SpanTreeNode, depth: number) => {
        if (seen.has(span.spanId)) return;
        seen.add(span.spanId);

        lines.push(indent(`- ${renderHeader(span)}`, depth));

        for (const block of renderSpanExtras(span)) {
          for (const ln of block) {
            lines.push(indent(`  ${ln}`, depth));
          }
        }

        const kids = childrenByParent.get(span.spanId) ?? [];
        for (const kid of kids) writeSpanBullets(kid, depth + 1);
      };

      // ----- Tree layout (box-drawing characters) -----
      // ancestorsLast: for each ancestor depth, true if that ancestor was the
      // last child at its level (so we draw a space; otherwise we draw │).
      const writeSpanTree = (
        span: SpanTreeNode,
        ancestorsLast: boolean[],
        isLast: boolean,
        isRoot: boolean,
      ) => {
        if (seen.has(span.spanId)) return;
        seen.add(span.spanId);

        const ancestorPad = ancestorsLast
          .map((last) => (last ? "    " : "│   "))
          .join("");
        const branch = isRoot ? "" : isLast ? "└── " : "├── ";
        lines.push(`${ancestorPad}${branch}${renderHeader(span)}`);

        const childPrefix =
          ancestorPad + (isRoot ? "" : isLast ? "    " : "│   ");
        for (const block of renderSpanExtras(span)) {
          for (const ln of block) {
            lines.push(`${childPrefix}${ln}`);
          }
        }

        const kids = childrenByParent.get(span.spanId) ?? [];
        const nextAncestors = isRoot
          ? ancestorsLast
          : [...ancestorsLast, isLast];
        kids.forEach((kid, i) => {
          writeSpanTree(kid, nextAncestors, i === kids.length - 1, false);
        });
      };

      const filteredIds = new Set(filtered.map((s) => s.spanId));
      const rootCandidates = filtered.filter(
        (s) => s.parentSpanId == null || !filteredIds.has(s.parentSpanId),
      );
      rootCandidates.sort((a, b) => a.startTimeMs - b.startTimeMs);

      if (useTree) {
        // Tree output is a single fenced code block so monospace alignment
        // survives both rendered-markdown and source views.
        lines.push("```");
        rootCandidates.forEach((root, i) => {
          writeSpanTree(root, [], i === rootCandidates.length - 1, true);
        });
        for (const span of filtered) {
          if (!seen.has(span.spanId)) writeSpanTree(span, [], true, true);
        }
        lines.push("```");
      } else {
        for (const root of rootCandidates) writeSpanBullets(root, 0);
        for (const span of filtered) {
          if (!seen.has(span.spanId)) writeSpanBullets(span, 0);
        }
      }
      lines.push("");
    }
  }

  if (trace.events && trace.events.length > 0) {
    lines.push("## Events");
    lines.push("");
    for (const evt of trace.events) {
      const offsetMs = Math.max(0, Math.round(evt.timestamp - trace.timestamp));
      lines.push(`- **${evt.name}** at +${offsetMs}ms (\`${evt.spanId}\`)`);
    }
    lines.push("");
  }

  if (opts.includeMetadata && Object.keys(trace.attributes).length > 0) {
    lines.push("## Metadata");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(trace.attributes, null, 2));
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

type ViewMode = "rendered" | "source";

export function MarkdownConfigurePopover({
  config,
  onChange,
  placement = "bottom-end",
}: {
  config: MarkdownConfig;
  onChange: (next: MarkdownConfig) => void;
  placement?: "top-start" | "bottom-end";
}) {
  return (
    <PopoverRoot positioning={{ placement }}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          colorPalette="blue"
          paddingX={2}
          height="24px"
          gap={1}
        >
          <Icon as={LuSettings2} boxSize={3} />
          <Text textStyle="2xs" fontWeight="semibold">
            Configure
          </Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent width="220px">
        <PopoverArrow />
        <PopoverBody padding={2.5}>
          <VStack align="stretch" gap={2.5}>
            <VStack align="stretch" gap={1}>
              <Text
                textStyle="2xs"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="0.06em"
                fontWeight="semibold"
              >
                Sections
              </Text>
              <Checkbox
                size="sm"
                checked={config.includeIO}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeIO: checked === true })
                }
              >
                <Text textStyle="xs">Input / Output</Text>
              </Checkbox>
              <Checkbox
                size="sm"
                checked={config.includeMetadata}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeMetadata: checked === true })
                }
              >
                <Text textStyle="xs">Metadata</Text>
              </Checkbox>
              <Checkbox
                size="sm"
                checked={config.includeSpanIO}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeSpanIO: checked === true })
                }
              >
                <Text textStyle="xs">Per-span input / output</Text>
              </Checkbox>
              <Checkbox
                size="sm"
                checked={config.includeSpanAttributes}
                onCheckedChange={({ checked }) =>
                  onChange({
                    ...config,
                    includeSpanAttributes: checked === true,
                  })
                }
              >
                <Text textStyle="xs">Per-span attributes</Text>
              </Checkbox>
            </VStack>

            <VStack align="stretch" gap={1}>
              <Text
                textStyle="2xs"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="0.06em"
                fontWeight="semibold"
              >
                Spans · scope
              </Text>
              <RadioGroup
                size="sm"
                value={config.spanScope}
                onValueChange={({ value }) =>
                  onChange({ ...config, spanScope: value as SpanScope })
                }
              >
                <VStack align="stretch" gap={1}>
                  <Radio value="none">
                    <Text textStyle="xs">No spans</Text>
                  </Radio>
                  <Radio value="ai">
                    <Text textStyle="xs">AI spans only</Text>
                  </Radio>
                  <Radio value="all">
                    <Text textStyle="xs">All spans</Text>
                  </Radio>
                </VStack>
              </RadioGroup>
            </VStack>

            {config.spanScope !== "none" && (
              <VStack align="stretch" gap={1}>
                <Text
                  textStyle="2xs"
                  color="fg.muted"
                  textTransform="uppercase"
                  letterSpacing="0.06em"
                  fontWeight="semibold"
                >
                  Spans · detail
                </Text>
                <RadioGroup
                  size="sm"
                  value={config.spanDetail}
                  onValueChange={({ value }) =>
                    onChange({
                      ...config,
                      spanDetail: value as SpanDetailLevel,
                    })
                  }
                >
                  <VStack align="stretch" gap={1}>
                    <Radio value="names">
                      <Text textStyle="xs">Names only</Text>
                    </Radio>
                    <Radio value="core">
                      <Text textStyle="xs">+ duration, model, status</Text>
                    </Radio>
                    <Radio value="full">
                      <Text textStyle="xs">+ span IDs, timing</Text>
                    </Radio>
                  </VStack>
                </RadioGroup>
              </VStack>
            )}

            {config.spanScope !== "none" && (
              <VStack align="stretch" gap={1}>
                <Text
                  textStyle="2xs"
                  color="fg.muted"
                  textTransform="uppercase"
                  letterSpacing="0.06em"
                  fontWeight="semibold"
                >
                  Spans · layout
                </Text>
                <RadioGroup
                  size="sm"
                  value={config.spanLayout}
                  onValueChange={({ value }) =>
                    onChange({ ...config, spanLayout: value as SpanLayout })
                  }
                >
                  <VStack align="stretch" gap={1}>
                    <Radio value="tree">
                      <Text textStyle="xs">Tree</Text>
                    </Radio>
                    <Radio value="bullets">
                      <Text textStyle="xs">Bullets</Text>
                    </Radio>
                  </VStack>
                </RadioGroup>
              </VStack>
            )}
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}

export function MarkdownCopyButton({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button
      size="sm"
      variant="outline"
      colorPalette="blue"
      onClick={handleCopy}
      paddingX={2}
      height="24px"
      gap={1}
    >
      <Icon as={copied ? LuCheck : LuCopy} boxSize={3} />
      <Text textStyle="2xs" fontWeight="semibold">
        {copied ? "Copied" : "Copy"}
      </Text>
    </Button>
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

  const shikiAdapter = useMemo(() => {
    return createShikiAdapter<HighlighterGeneric<any, any>>({
      async load() {
        const { createHighlighter } = await import("shiki");
        return createHighlighter({
          langs: ["markdown", "json", "bash", "typescript", "python"],
          themes: ["github-dark", "github-light"],
        });
      },
      theme: colorMode === "dark" ? "github-dark" : "github-light",
    });
  }, [colorMode]);

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
            <Box
              paddingX={2}
              paddingY={1.5}
              textStyle="sm"
              color="fg"
              lineHeight="1.7"
              css={{
                "& h1": { fontSize: "lg", fontWeight: "bold", marginTop: "0.75rem", marginBottom: "0.5rem" },
                "& h2": { fontSize: "md", fontWeight: "semibold", marginTop: "1rem", marginBottom: "0.4rem" },
                "& h3": { fontSize: "sm", fontWeight: "semibold", marginTop: "0.75rem", marginBottom: "0.3rem" },
                "& p": { marginBottom: "0.5rem" },
                "& ul": { marginLeft: "1.25rem", marginBottom: "0.5rem", listStyle: "disc" },
                "& ol": { marginLeft: "1.25rem", marginBottom: "0.5rem" },
                "& li": { marginBottom: "0.15rem" },
                "& :not(pre) > code": {
                  fontFamily: "var(--chakra-fonts-mono)",
                  fontSize: "0.85em",
                  padding: "1px 4px",
                  borderRadius: "3px",
                  background: "var(--chakra-colors-bg-subtle)",
                  border: "1px solid",
                  borderColor: "var(--chakra-colors-border-muted)",
                },
                "& strong": { fontWeight: "semibold" },
                "& a": { color: "var(--chakra-colors-blue-fg)", textDecoration: "underline" },
              }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code(props) {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { node, className, children, ...rest } = props;
                    const match = /language-(\w+)/.exec(className ?? "");
                    const lang = match ? match[1] : undefined;
                    const code = String(children).replace(/\n$/, "");
                    if (!lang) return <code {...rest}>{children}</code>;
                    return (
                      <ShikiCodeBlock
                        code={code}
                        language={lang}
                        colorMode={colorMode}
                      />
                    );
                  },
                }}
              >
                {markdown}
              </ReactMarkdown>
            </Box>
          ) : (
            <ShikiCodeBlock
              code={markdown}
              language="markdown"
              colorMode={colorMode}
              flush
            />
          )}
        </Box>

        {/* Footer: view mode toggle */}
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

function ShikiCodeBlock({
  code,
  language,
  colorMode,
  flush,
}: {
  code: string;
  language: string;
  colorMode: string;
  flush?: boolean;
}) {
  return (
    <ClientOnly fallback={
      <Box
        as="pre"
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        lineHeight="1.6"
        padding={flush ? 4 : 2.5}
        borderRadius={flush ? 0 : "md"}
        borderWidth={flush ? 0 : "1px"}
        borderColor="border.muted"
        bg={flush ? "transparent" : "bg.subtle"}
        marginBottom={flush ? 0 : 2}
      >
        {code}
      </Box>
    }>
      {() => (
        <CodeBlock.Root
          size="sm"
          code={code}
          language={language}
          meta={{ colorScheme: colorMode }}
          borderRadius={flush ? 0 : "md"}
          borderWidth={flush ? 0 : "1px"}
          borderColor="border.muted"
          bg={flush ? "transparent" : "bg.subtle"}
          marginBottom={flush ? 0 : 1.5}
          overflow="hidden"
        >
          <CodeBlock.Content
            paddingX={flush ? 2 : 2}
            paddingY={flush ? 1.5 : 1.5}
            css={{
              "& pre, & code": {
                background: "transparent !important",
                fontSize: flush ? "0.8em" : "0.78em",
                lineHeight: "1.55",
                padding: "0 !important",
                margin: "0 !important",
              },
            }}
          >
            <CodeBlock.Code>
              <CodeBlock.CodeText />
            </CodeBlock.Code>
          </CodeBlock.Content>
        </CodeBlock.Root>
      )}
    </ClientOnly>
  );
}
