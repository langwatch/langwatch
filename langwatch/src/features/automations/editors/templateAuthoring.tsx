import { Badge, Box, Button, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import type { Monaco, OnMount } from "@monaco-editor/react";
import { ExternalLink, Link2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef } from "react";
import * as React from "react";
import dynamic from "~/utils/compat/next-dynamic";
import monokaiTheme from "~/optimization_studio/components/code/Monokai.json";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import {
  clearLiquidMarkers,
  LIQUID_JSON_LANGUAGE_ID,
  LIQUID_LANGUAGE_ID,
  type MonacoTextModel,
  registerLiquidLanguage,
  setupLiquidJsonSchema,
  validateLiquidModel,
  type VariableInfo,
} from "./liquidMonaco";
import { useMonacoTheme } from "./useMonacoTheme";

export type { VariableInfo };

/**
 * Building blocks shared by every notification config stage (email subject,
 * email body, Slack template): a Monaco Liquid editor with autocomplete +
 * unknown-variable validation, a "using default" header with Reset, plus
 * compact preview pieces (`CompactEmailPreview`, `CompactSlackPreview`) —
 * just the rendered output, no surrounding chrome / variable reference /
 * example-data panels. The heavier "variable surface" lives next to each
 * field header as a hover tooltip on `VariableInfoIcon`.
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
  trailing,
}: {
  label: string;
  usingDefault: boolean;
  onReset: () => void;
  /** Optional element rendered next to the label — used by template fields
   *  to slot a `VariableInfoIcon`. Keeps the row chrome out of this primitive. */
  trailing?: React.ReactNode;
}) {
  return (
    <HStack gap={2}>
      <Text textStyle="sm" fontWeight="semibold">
        {label}
      </Text>
      {trailing}
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
  jsonSchema,
  jsonSchemaShadowUri,
}: {
  value: string;
  onChange: (value: string) => void;
  variables: VariableInfo[];
  /** "liquid" (default) for regular templates, "liquid-json" for slack
   *  block_kit (JSON whose string values carry Liquid). */
  language?: string;
  height?: string;
  /** Optional JSON Schema to validate the source against. Liquid spans are
   *  stripped to same-length placeholders before validation, so any markers
   *  Monaco's JSON service produces map back 1:1 onto the editor. Pass with
   *  `jsonSchemaShadowUri` — a stable per-editor URI. */
  jsonSchema?: object;
  jsonSchemaShadowUri?: string;
}) {
  const isLiquid =
    language === LIQUID_LANGUAGE_ID || language === LIQUID_JSON_LANGUAGE_ID;
  const theme = useMonacoTheme();
  const monacoRef = useRef<Monaco | null>(null);
  const modelRef = useRef<MonacoTextModel | null>(null);
  const changeSubscription = useRef<{ dispose: () => void } | null>(null);
  const schemaSubscription = useRef<{ dispose: () => void } | null>(null);
  // Track when the editor has mounted so the schema-setup useEffect below can
  // react to prop changes (e.g. toggling the Slack template type to block_kit)
  // even though `onMount` only fires once. Without this, the editor mounted in
  // Plain-text mode never got its shadow model when the user switched.
  const [mounted, setMounted] = React.useState(false);

  useEffect(
    () => () => {
      changeSubscription.current?.dispose();
      schemaSubscription.current?.dispose();
      if (monacoRef.current && modelRef.current) {
        clearLiquidMarkers(monacoRef.current, modelRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    schemaSubscription.current?.dispose();
    schemaSubscription.current = null;
    const monaco = monacoRef.current;
    const model = modelRef.current;
    if (!mounted || !monaco || !model) return;
    if (!jsonSchema || !jsonSchemaShadowUri) return;
    schemaSubscription.current = setupLiquidJsonSchema({
      monaco,
      realModel: model,
      schema: jsonSchema,
      shadowUri: jsonSchemaShadowUri,
    });
    return () => {
      schemaSubscription.current?.dispose();
      schemaSubscription.current = null;
    };
  }, [mounted, jsonSchema, jsonSchemaShadowUri]);

  const onMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    const model = editor.getModel();
    modelRef.current = model;
    if (isLiquid && model) validateLiquidModel(monaco, model, variables);
    if (isLiquid) {
      changeSubscription.current = editor.onDidChangeModelContent(() => {
        const current = editor.getModel();
        if (current) validateLiquidModel(monaco, current, variables);
      });
    }
    setMounted(true);
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
        value={value}
        theme={theme}
        beforeMount={(monaco: Monaco) => {
          defineMonokai(monaco);
          registerLiquidLanguage(monaco, variables);
        }}
        onMount={onMount}
        onChange={(next: string | undefined) => onChange(next ?? "")}
        options={editorOptions}
      />
    </Box>
  );
}

/**
 * Compact email preview — the rendered HTML in a small sandboxed iframe,
 * with the subject line above. No surrounding panel chrome; sized to sit
 * inline below the body editor without dominating the drawer.
 */
export function CompactEmailPreview({
  subject,
  html,
}: {
  subject: string;
  html: string;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text textStyle="xs" color="fg.muted">
        Subject
      </Text>
      <Text fontWeight="medium" textStyle="sm">
        {subject}
      </Text>
      {/* Native vertical resize so the author can pull the preview taller
          when the body content overruns the default. Drag the bottom-right
          corner. We expose a sensible default + a min height so the iframe
          doesn't collapse to nothing. */}
      <Box
        border="1px solid"
        borderColor="border"
        borderRadius="md"
        overflow="hidden"
        height="220px"
        minHeight="120px"
        bg="white"
        css={{ resize: "vertical" }}
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

/** Name of the synced popup window. Reused across calls so a second click
 *  re-points the existing popup instead of opening a new one. */
const SYNCED_BUILDER_WINDOW_NAME = "lwBlockKitBuilder";

/** Compact Slack preview — renders mrkdwn or Block Kit blocks inline, no
 *  border chrome. For `block_kit` mode the inline render is honest about
 *  being a rough approximation (our preview will never match Slack's actual
 *  UI exactly); below it sit two ways to see the real thing:
 *
 *  - "Open in Block Kit Builder" — one-shot, fires `window.open` with the
 *    current JSON. The popup is independent and won't update on further edits.
 *  - "Open synced Block Kit Builder" — opens a named popup we keep a handle
 *    to and re-navigate on every preview change. Slack's Block Kit Builder
 *    reads the JSON from the URL fragment, so `popup.location.replace` with
 *    the new fragment fires `hashchange` inside Slack's app and the rendered
 *    blocks follow along. If the popup is closed, the next click reopens it.
 *
 *  An iframe would be ideal but Slack sets `X-Frame-Options: SAMEORIGIN`,
 *  so cross-origin embedding is a non-starter. The popup is the closest
 *  thing to a live preview we can actually have. */
export function CompactSlackPreview({
  payload,
}: {
  payload: { text: string } | { blocks: SlackBlock[] };
}) {
  const builderUrl = useMemo(() => {
    if (!("blocks" in payload)) return null;
    const json = JSON.stringify({ blocks: payload.blocks });
    return `https://app.slack.com/block-kit-builder#${encodeURIComponent(json)}`;
  }, [payload]);

  const syncedPopup = useRef<Window | null>(null);

  // Keep the synced popup in step with the latest payload. If the user
  // never opened it, this is a no-op. If they closed it, we drop the
  // stale handle so the next click reopens a fresh window. Wrapped in
  // try/catch because some browsers raise a SecurityError if the popup
  // navigated to a page that briefly errored — we don't want a preview
  // hiccup to crash the editor.
  useEffect(() => {
    if (!builderUrl) return;
    const popup = syncedPopup.current;
    if (!popup) return;
    if (popup.closed) {
      syncedPopup.current = null;
      return;
    }
    try {
      popup.location.replace(builderUrl);
    } catch {
      // Cross-origin navigation hiccup — user can click the button again.
    }
  }, [builderUrl]);

  const openOnce = () => {
    if (!builderUrl) return;
    window.open(builderUrl, "_blank", "noopener,noreferrer");
  };

  const openSynced = () => {
    if (!builderUrl) return;
    const existing = syncedPopup.current;
    if (existing && !existing.closed) {
      try {
        existing.location.replace(builderUrl);
      } catch {
        // ignore — popup will be re-opened below if this throws repeatedly
      }
      existing.focus();
      return;
    }
    syncedPopup.current = window.open(
      builderUrl,
      SYNCED_BUILDER_WINDOW_NAME,
      "width=1200,height=900,noopener=no,noreferrer=no",
    );
  };

  return (
    <VStack align="stretch" gap={2}>
      {/* Vertically resizable so a long Block Kit preview can be pulled up
          to fit instead of pushing the editor off-screen. */}
      <Box
        bg="bg.subtle"
        borderRadius="md"
        padding={3}
        height="200px"
        minHeight="100px"
        overflowY="auto"
        css={{ resize: "vertical" }}
      >
        {"text" in payload ? (
          <Text whiteSpace="pre-wrap" textStyle="sm">
            {renderSlackMrkdwn(payload.text)}
          </Text>
        ) : (
          <BlockKitBlocks blocks={payload.blocks} />
        )}
      </Box>
      {builderUrl ? (
        <HStack gap={2} align="center" flexWrap="wrap">
          <Tooltip
            content="Opens Slack's Block Kit Builder in a new tab with this template's current JSON. Standalone — won't track further edits."
            positioning={{ placement: "top" }}
          >
            <Button size="xs" variant="outline" onClick={openOnce}>
              <ExternalLink size={12} /> Open in Block Kit Builder
            </Button>
          </Tooltip>
          <Tooltip
            content="Opens Slack's Block Kit Builder in a popup window that follows your edits. Slack reads the JSON from the URL fragment, so changes here re-point the popup live. Closing the popup is fine — the next click reopens it."
            positioning={{ placement: "top" }}
          >
            <Button size="xs" variant="outline" onClick={openSynced}>
              <Link2 size={12} /> Open synced Block Kit Builder
            </Button>
          </Tooltip>
          <Text textStyle="xs" color="fg.muted">
            Slack blocks iframes — popup is as close to live as we can get.
          </Text>
        </HStack>
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
        <Text fontWeight="bold" textStyle="sm">
          {blockText(block)}
        </Text>
      );
    case "section":
      return (
        <Text whiteSpace="pre-wrap" textStyle="sm">
          {renderSlackMrkdwn(blockText(block))}
        </Text>
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
        <Fragment key={key++}>
          {renderBold(text.slice(lastIndex, match.index))}
        </Fragment>,
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
    nodes.push(
      <Fragment key={key++}>{renderBold(text.slice(lastIndex))}</Fragment>,
    );
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

