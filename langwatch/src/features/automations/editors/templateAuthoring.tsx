import { Badge, Box, Button, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import type { Monaco, OnMount } from "@monaco-editor/react";
import { Fragment, useEffect, useMemo, useRef } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import dynamic from "~/utils/compat/next-dynamic";
import monokaiTheme from "~/optimization_studio/components/code/Monokai.json";
import { Link } from "~/components/ui/link";
import {
  clearLiquidMarkers,
  LIQUID_LANGUAGE_ID,
  type MonacoTextModel,
  registerLiquidLanguage,
  validateLiquidModel,
  type VariableInfo,
} from "./liquidMonaco";
import {
  SLACK_BLOCK_KIT_JSON_SCHEMA,
  SLACK_BLOCK_KIT_MODEL_URI,
  registerJsonSchema,
} from "./monacoSchemas";
import { useMonacoTheme } from "./useMonacoTheme";

export type { VariableInfo };

/**
 * Building blocks shared by every notification config stage (email subject,
 * email body, Slack template): a Monaco Liquid editor with autocomplete +
 * unknown-variable validation, a "using default" header with Reset, plus the
 * preview side (email iframe, Slack Block Kit / mrkdwn) and the variable +
 * example panels. Extracted so the staged automation drawer (ADR-028) can
 * compose them per type.
 */

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

export interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

export function FieldHeader({
  label,
  usingDefault,
  onReset,
}: {
  label: string;
  usingDefault: boolean;
  onReset: () => void;
}) {
  return (
    <HStack>
      <Text textStyle="sm" fontWeight="semibold">
        {label}
      </Text>
      {usingDefault ? (
        <Badge size="sm" colorPalette="gray">
          Using default
        </Badge>
      ) : (
        <Button size="xs" variant="ghost" onClick={onReset}>
          Reset to default
        </Button>
      )}
    </HStack>
  );
}

function defineMonokai(monaco: Monaco) {
  monaco.editor.defineTheme(
    "monokai",
    monokaiTheme as Parameters<typeof monaco.editor.defineTheme>[1],
  );
}

const editorOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: "on" as const,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  lineNumbers: "off" as const,
  tabSize: 2,
  padding: { top: 12 },
};

export function LiquidEditor({
  value,
  onChange,
  variables,
  language = LIQUID_LANGUAGE_ID,
  height = "200px",
}: {
  value: string;
  onChange: (value: string) => void;
  variables: VariableInfo[];
  /** "liquid" (default) for regular templates, "json" for slack block_kit
   *  (which carries Liquid inside string values; structural JSON is validated
   *  against the Slack Block Kit schema). */
  language?: string;
  height?: string;
}) {
  const isLiquid = language === LIQUID_LANGUAGE_ID;
  const theme = useMonacoTheme();
  const monacoRef = useRef<Monaco | null>(null);
  const modelRef = useRef<MonacoTextModel | null>(null);
  const changeSubscription = useRef<{ dispose: () => void } | null>(null);

  useEffect(
    () => () => {
      changeSubscription.current?.dispose();
      if (monacoRef.current && modelRef.current) {
        clearLiquidMarkers(monacoRef.current, modelRef.current);
      }
    },
    [],
  );

  const onMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    const model = editor.getModel();
    modelRef.current = model;
    if (isLiquid && model) validateLiquidModel(monaco, model, variables);
    if (!isLiquid) return;
    changeSubscription.current = editor.onDidChangeModelContent(() => {
      const current = editor.getModel();
      if (current) validateLiquidModel(monaco, current, variables);
    });
  };

  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
      height={height}
      background={theme === "monokai" ? "#272822" : "white"}
    >
      <MonacoEditor
        height="100%"
        language={language}
        path={isLiquid ? undefined : SLACK_BLOCK_KIT_MODEL_URI}
        value={value}
        theme={theme}
        beforeMount={(monaco: Monaco) => {
          defineMonokai(monaco);
          if (isLiquid) {
            registerLiquidLanguage(monaco, variables);
          } else {
            registerJsonSchema(
              monaco,
              SLACK_BLOCK_KIT_MODEL_URI,
              SLACK_BLOCK_KIT_JSON_SCHEMA,
            );
          }
        }}
        onMount={onMount}
        onChange={(next: string | undefined) => onChange(next ?? "")}
        options={editorOptions}
      />
    </Box>
  );
}

export function VariableReference({ variables }: { variables: VariableInfo[] }) {
  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      padding={3}
      bg="bg.subtle"
    >
      <Text textStyle="xs" fontWeight="semibold" color="fg.muted" mb={1}>
        Available variables
      </Text>
      <Text textStyle="xs" color="fg.muted" mb={2}>
        On <strong>immediate</strong> cadence (today), every fire surfaces the
        matched trace under <Text as="span" fontFamily="mono">match.*</Text>. A
        future <strong>digest</strong> cadence will additionally expose{" "}
        <Text as="span" fontFamily="mono">matches[]</Text> for iteration;{" "}
        <Text as="span" fontFamily="mono">digest.count</Text> reports the size.
      </Text>
      <VStack align="stretch" gap={1}>
        {variables.map((variable) => (
          <HStack
            key={variable.path}
            gap={2}
            align="baseline"
            title={variable.description}
          >
            <Badge size="sm" fontFamily="mono" colorPalette="gray">
              {variable.path}
            </Badge>
            <Text textStyle="xs" color="fg.muted" fontFamily="mono">
              {variable.type}
            </Text>
            {variable.description ? (
              <Text textStyle="xs" color="fg.muted" lineClamp={1}>
                — {variable.description}
              </Text>
            ) : null}
          </HStack>
        ))}
      </VStack>
    </Box>
  );
}

export function ExampleData({ example }: { example: unknown }) {
  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      padding={3}
      bg="bg.subtle"
    >
      <Text textStyle="xs" fontWeight="semibold" color="fg.muted" mb={2}>
        Example data the preview renders against
      </Text>
      <Box
        as="pre"
        textStyle="xs"
        fontFamily="mono"
        whiteSpace="pre-wrap"
        color="fg.muted"
        maxHeight="200px"
        overflowY="auto"
      >
        {JSON.stringify(example, null, 2)}
      </Box>
    </Box>
  );
}

export function PreviewWarnings({
  data,
}: {
  data:
    | { usedDefault: boolean; missingVariables: string[]; errors: string[] }
    | undefined;
}) {
  if (!data) return null;
  const notes: string[] = [];
  if (data.errors.length > 0) {
    notes.push(`Fell back to the default template: ${data.errors.join("; ")}`);
  } else if (data.usedDefault) {
    notes.push("Rendered with the framework default template.");
  }
  if (data.missingVariables.length > 0) {
    notes.push(
      `Missing variables rendered empty: ${data.missingVariables.join(", ")}`,
    );
  }
  if (notes.length === 0) return null;

  return (
    <VStack align="stretch" gap={1}>
      {notes.map((note, i) => (
        <HStack
          key={i}
          gap={2}
          color="fg.warning"
          textStyle="xs"
          align="flex-start"
        >
          <Box pt="2px">
            <AlertTriangle size={13} />
          </Box>
          <Text>{note}</Text>
        </HStack>
      ))}
    </VStack>
  );
}

export function EmailPreview({
  subject,
  html,
}: {
  subject: string;
  html: string;
}) {
  return (
    <VStack align="stretch" gap={2} height="full">
      <Box>
        <Text textStyle="xs" color="fg.muted">
          Subject
        </Text>
        <Text fontWeight="medium">{subject}</Text>
      </Box>
      <Box
        border="1px solid"
        borderColor="border"
        borderRadius="md"
        overflow="hidden"
        flex="1"
        minHeight="320px"
        bg="white"
      >
        <iframe
          srcDoc={html}
          sandbox=""
          title="Email preview"
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </Box>
    </VStack>
  );
}

type SlackBlock = Record<string, unknown>;

export function SlackPreview({
  payload,
}: {
  payload: { text: string } | { blocks: SlackBlock[] };
}) {
  const builderUrl = useMemo(() => {
    if (!("blocks" in payload)) return null;
    const json = JSON.stringify({ blocks: payload.blocks });
    return `https://app.slack.com/block-kit-builder#${encodeURIComponent(json)}`;
  }, [payload]);

  return (
    <VStack align="stretch" gap={2}>
      <Box
        border="1px solid"
        borderColor="border"
        borderRadius="md"
        padding={3}
        bg="bg.panel"
      >
        {"text" in payload ? (
          <Text whiteSpace="pre-wrap">{renderSlackMrkdwn(payload.text)}</Text>
        ) : (
          <BlockKitBlocks blocks={payload.blocks} />
        )}
      </Box>
      {builderUrl ? (
        <Link href={builderUrl} isExternal color="orange.400" textStyle="sm">
          <HStack gap={1}>
            <Text>Open in Slack Block Kit Builder</Text>
            <ExternalLink size={13} />
          </HStack>
        </Link>
      ) : null}
    </VStack>
  );
}

function BlockKitBlocks({ blocks }: { blocks: SlackBlock[] }) {
  return (
    <VStack align="stretch" gap={2}>
      {blocks.map((block, i) => (
        <BlockKitBlock key={i} block={block} />
      ))}
    </VStack>
  );
}

function blockText(block: SlackBlock): string {
  const text = block.text;
  if (typeof text === "string") return text;
  if (text && typeof text === "object" && "text" in text) {
    const inner = (text as { text?: unknown }).text;
    return typeof inner === "string" ? inner : "";
  }
  return "";
}

function BlockKitBlock({ block }: { block: SlackBlock }) {
  switch (block.type) {
    case "header":
      return (
        <Text fontWeight="bold" textStyle="md">
          {blockText(block)}
        </Text>
      );
    case "section":
      return (
        <Text whiteSpace="pre-wrap">{renderSlackMrkdwn(blockText(block))}</Text>
      );
    case "context": {
      const elements = Array.isArray(block.elements) ? block.elements : [];
      const text = elements
        .map((el) =>
          el && typeof el === "object" && "text" in el
            ? String((el as { text?: unknown }).text ?? "")
            : "",
        )
        .join("  ");
      return (
        <Text textStyle="xs" color="fg.muted" whiteSpace="pre-wrap">
          {renderSlackMrkdwn(text)}
        </Text>
      );
    }
    case "divider":
      return <Separator />;
    case "image": {
      const url = typeof block.image_url === "string" ? block.image_url : "";
      const alt = typeof block.alt_text === "string" ? block.alt_text : "";
      return url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} style={{ maxWidth: "100%", borderRadius: 6 }} />
      ) : null;
    }
    default:
      return null;
  }
}

function renderSlackMrkdwn(text: string): React.ReactNode[] {
  const linkPattern = /<(https?:\/\/[^>|]+)(?:\|([^>]+))?>/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = linkPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={key++}>{renderBold(text.slice(lastIndex, match.index))}</Fragment>,
      );
    }
    const url = match[1]!;
    const label = match[2] ?? url;
    nodes.push(
      <Link key={key++} href={url} isExternal color="orange.400">
        {label}
      </Link>,
    );
    lastIndex = linkPattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={key++}>{renderBold(text.slice(lastIndex))}</Fragment>);
  }
  return nodes;
}

function renderBold(text: string): React.ReactNode[] {
  return text.split(/(\*[^*]+\*)/g).map((segment, i) =>
    segment.startsWith("*") && segment.endsWith("*") && segment.length > 2 ? (
      <Text as="span" key={i} fontWeight="bold">
        {segment.slice(1, -1)}
      </Text>
    ) : (
      <Fragment key={i}>{segment}</Fragment>
    ),
  );
}
