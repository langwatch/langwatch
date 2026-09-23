import { Badge, Box, Button, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { Monaco, OnMount } from "@monaco-editor/react";
import { ChevronDown, ChevronRight, ExternalLink, Link2 } from "lucide-react";
import * as React from "react";
import { lazy, Suspense, useEffect, useMemo, useRef, type ComponentProps } from "react";
import { FaSlack } from "react-icons/fa";

import { AutomationMarkdown as Markdown } from "../../../../ui/elements/automation-markdown.tsx";
import {
  monacoBackgroundFor,
  trapEscapeInsideEditor,
  useMonacoTheme,
  clearLiquidMarkers,
  clearModelVariables,
  LIQUID_JSON_LANGUAGE_ID,
  LIQUID_LANGUAGE_ID,
  type MonacoTextModel,
  registerLiquidLanguage,
  setModelVariables,
  setupLiquidJsonSchema,
  type VariableInfo as MonacoVariableInfo,
  validateLiquidModel,
} from "../../../liquid-editor/index.ts";

export type VariableInfo = MonacoVariableInfo;

// Shared building blocks for notification config stages: Monaco Liquid editor with autocomplete
// + validation, compact preview pieces, variable surface in hover tooltip.

// Lazy-load Monaco editor locally (not via platform/app) so slow chunk doesn't blank the drawer.
const LazyMonacoEditor = lazy(async () => {
  const module = await import("@monaco-editor/react");
  return { default: module.default };
});

function MonacoEditor(props: ComponentProps<typeof LazyMonacoEditor>) {
  return (
    <Suspense
      fallback={
        <Box padding={4} color="fg.muted">
          Loading editor...
        </Box>
      }
    >
      <LazyMonacoEditor {...props} />
    </Suspense>
  );
}

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
  /**
   * Optional element rendered next to the label — used by template fields to slot a
   * `VariableInfoIcon`. Keeps the row chrome out of this primitive.
   */
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

/**
 * Opt-in expander for the layered template authoring flow: the default
 * (preset gallery, preview) stays simple; deeper editing sits behind
 * these so most authors never see a brace. Children mount only while open.
 */
export function TemplateDisclosure({
  triggerLabel,
  hint,
  open,
  onToggle,
  children,
}: {
  triggerLabel: string;
  /** One-line, plain-language note shown once the tier is open. */
  hint?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <VStack align="stretch" gap={0}>
      <chakra.button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        display="inline-flex"
        alignItems="center"
        gap={1}
        width="fit-content"
        bg="transparent"
        border="none"
        cursor="pointer"
        color="fg.muted"
        _hover={{ color: "fg" }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Text textStyle="sm" fontWeight="medium">
          {triggerLabel}
        </Text>
      </chakra.button>
      {open ? (
        <VStack align="stretch" gap={2} pt={2}>
          {hint ? (
            <Text textStyle="xs" color="fg.muted">
              {hint}
            </Text>
          ) : null}
          {children}
        </VStack>
      ) : null}
    </VStack>
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
  /**
   * "liquid" (default) for regular templates, "liquid-json" for slack block_kit (JSON whose string
   * values carry Liquid).
   */
  language?: string;
  height?: string;
  /**
   * Optional JSON Schema to validate the source against. Liquid spans are stripped to same-length
   * placeholders before validation, so any markers Monaco's JSON service produces map back 1:1 onto
   * the editor. Pass with `jsonSchemaShadowUri` — a stable per-editor URI.
   */
  jsonSchema?: object;
  jsonSchemaShadowUri?: string;
}) {
  const isLiquid = language === LIQUID_LANGUAGE_ID || language === LIQUID_JSON_LANGUAGE_ID;
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
      if (modelRef.current) {
        clearModelVariables(modelRef.current);
      }
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
    if (model) setModelVariables(model, variables);
    if (isLiquid && model) validateLiquidModel(monaco, model, variables);
    if (isLiquid) {
      changeSubscription.current = editor.onDidChangeModelContent(() => {
        const current = editor.getModel();
        if (current) validateLiquidModel(monaco, current, variables);
      });
    }
    trapEscapeInsideEditor(editor);
    setMounted(true);
  };

  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
      height={height}
      background={monacoBackgroundFor(theme)}
    >
      <MonacoEditor
        height="100%"
        language={language}
        value={value}
        theme={theme}
        beforeMount={(monaco: Monaco) => {
          registerLiquidLanguage(monaco);
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
  previewHeight = "220px",
}: {
  subject: string;
  html: string;
  /**
   * Default iframe height. Callers in drawers with lots of vertical room pass a larger value; the
   * user-resize handle still works.
   */
  previewHeight?: string;
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
        height={previewHeight}
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

/**
 * Name of the synced popup window. Reused across calls so a second click re-points the existing
 * popup instead of opening a new one.
 */
const SYNCED_BUILDER_WINDOW_NAME = "lwBlockKitBuilder";

// Compact Slack preview: plain-text renders mrkdwn inline; Block Kit shows block count + links to
// Block Kit Builder (one-shot or synced popup that follows edits).
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

  // Keeps the synced popup in step with the latest payload; closing it
  // drops the stale handle so the next click reopens fresh. Wrapped in
  // try/catch since some browsers raise a SecurityError on a popup that
  // briefly errored -- a preview hiccup shouldn't crash the editor.
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
    // We need the window handle to push updates into the Block Kit
    // Builder, so we can't use `noopener` (it would null the handle).
    // Instead we strip `window.opener` after open -- blocking reverse-tab
    // nabbing (the cross-origin builder can't navigate this tab) while
    // keeping the forward sync channel alive.
    const popup = window.open(builderUrl, SYNCED_BUILDER_WINDOW_NAME, "width=1200,height=900");
    if (popup) {
      try {
        popup.opener = null;
      } catch {
        // Cross-origin write may throw once the popup navigates; the same
        // cross-origin block then prevents the popup from reading us anyway.
      }
    }
    syncedPopup.current = popup;
  };

  if ("text" in payload) {
    return <SlackTextPreviewCard text={payload.text} />;
  }

  const blockCount = payload.blocks.length;
  return (
    <Box bg="bg.subtle" borderRadius="md" padding={4} border="1px solid" borderColor="border">
      <VStack align="stretch" gap={3}>
        <VStack align="stretch" gap={1}>
          <Text textStyle="sm" fontWeight="semibold">
            Preview in Slack's Block Kit Builder
          </Text>
          <Text textStyle="xs" color="fg.muted">
            {blockCount === 1
              ? "1 block ready to preview."
              : `${blockCount} blocks ready to preview.`}{" "}
            Block Kit renders differently than plain text, so preview where it will run.
          </Text>
        </VStack>
        <HStack gap={2} align="center" flexWrap="wrap">
          <Tooltip
            content="Preview your blocks in Slack's Block Kit Builder. Opens once in a new tab."
            positioning={{ placement: "top" }}
          >
            <Button size="sm" colorPalette="orange" variant="outline" onClick={openOnce}>
              <ExternalLink size={14} /> Open in Block Kit Builder
            </Button>
          </Tooltip>
          <Tooltip
            content="Live preview in Slack's Block Kit Builder. Updates as you edit."
            positioning={{ placement: "top" }}
          >
            <Button size="sm" colorPalette="orange" variant="solid" onClick={openSynced}>
              <Link2 size={14} /> Open synced Block Kit Builder
            </Button>
          </Tooltip>
        </HStack>
      </VStack>
    </Box>
  );
}

/**
 * Card-shaped preview for the plain-text Slack channel. Grows with the
 * content and runs text through `<Markdown>` so it looks like the real
 * Slack message -- close enough to be useful, far less effort than chrome.
 */
function SlackTextPreviewCard({ text }: { text: string }) {
  const asMarkdown = useMemo(() => slackMrkdwnToCommonMark(text), [text]);
  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="lg" overflow="hidden" bg="bg.panel">
      <HStack
        gap={2}
        align="center"
        paddingX={3}
        paddingY={2}
        borderBottomWidth="1px"
        borderColor="border"
        bg="bg.subtle"
      >
        <Box color="fg.muted">
          <FaSlack size={12} />
        </Box>
        <Text
          textStyle="xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wide"
        >
          Preview
        </Text>
        <Text textStyle="xs" color="fg.muted">
          How this message will appear in Slack
        </Text>
      </HStack>
      <Box padding={4}>
        <Markdown>{asMarkdown}</Markdown>
      </Box>
    </Box>
  );
}

// Translate Slack mrkdwn to CommonMark for rendering through standard pipeline: handles syntax
// differences only (bold, links); intentionally skips Slack user/channel mentions.
function slackMrkdwnToCommonMark(input: string): string {
  return (
    input
      // <https://url|label> → [label](url) ; <https://url> → <https://url>.
      // CommonMark autolinks the bare form, so leaving the angle brackets is
      // fine.
      .replace(
        /<(https?:\/\/[^>|\s]+)\|([^>]+)>/g,
        (_match, url: string, label: string) => `[${label.trim()}](${url})`,
      )
      // *bold* → **bold**. Restricted to runs without spaces at the boundary
      // (`*foo bar*` is bold; a stray `*` in prose like `2 * 3` won't match
      // because the next char is whitespace).
      .replace(
        /(^|[^*\w])\*([^*\n][^*\n]*?[^*\n\s])\*(?=[^*\w]|$)/g,
        (_match, lead: string, content: string) => `${lead}**${content}**`,
      )
      .replace(
        /(^|[^*\w])\*([^*\s])\*(?=[^*\w]|$)/g,
        (_match, lead: string, content: string) => `${lead}**${content}**`,
      )
      // ~strike~ → ~~strike~~ (GFM).
      .replace(
        /(^|[^~\w])~([^~\n][^~\n]*?[^~\n\s])~(?=[^~\w]|$)/g,
        (_match, lead: string, content: string) => `${lead}~~${content}~~`,
      )
      // Slack treats every `\n` as a visible line break. CommonMark
      // collapses single newlines into spaces and only honours blank lines
      // as paragraph breaks, so append two trailing spaces to every
      // newline that isn't already a paragraph break — that's the
      // CommonMark hard-break that renders as `<br>` under `<Markdown>`.
      .replace(/([^\n])\n(?!\n)/g, "$1  \n")
  );
}
