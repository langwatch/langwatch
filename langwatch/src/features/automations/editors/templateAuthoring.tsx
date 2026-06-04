import { Badge, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { Monaco, OnMount } from "@monaco-editor/react";
import { ExternalLink, Link2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import * as React from "react";
import { SiSlack } from "react-icons/si";
import dynamic from "~/utils/compat/next-dynamic";
import { Markdown } from "~/components/Markdown";
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
      background={theme === "vs-dark" ? "#1e1e1e" : "white"}
    >
      <MonacoEditor
        height="100%"
        language={language}
        value={value}
        theme={theme}
        beforeMount={(monaco: Monaco) => {
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

/** Compact Slack preview.
 *
 *  - Plain-text mode renders the mrkdwn inline — Slack's mrkdwn rendering
 *    is well-understood and the in-editor preview reads close enough that
 *    it's a useful proof the template parsed correctly.
 *  - Block Kit mode does NOT render the blocks inline. Slack's Block Kit
 *    UI is too distinct to approximate honestly, and a wrong-looking
 *    "preview" is worse than no preview — it gives the author false
 *    confidence in something that won't match Slack. Instead, the surface
 *    confirms how many blocks the JSON produced and offers two ways into
 *    Slack's actual Block Kit Builder:
 *
 *    • Open in Block Kit Builder — one-shot, new tab.
 *    • Open synced Block Kit Builder — named popup we keep a handle to
 *      and re-navigate on every edit so the rendered blocks follow along.
 *      An iframe would be ideal but Slack ships `X-Frame-Options:
 *      SAMEORIGIN`, so popup-sync is the closest live preview we can
 *      offer.
 */
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
    // We need the returned window handle to push template updates into the
    // Block Kit Builder as the operator edits, so we cannot use `noopener`
    // (which would null the handle). Instead, immediately strip
    // `window.opener` on the popup after open — this breaks the reverse-tab
    // nabbing vector (the cross-origin Block Kit Builder cannot navigate
    // this tab via `opener.location = …`) while keeping the forward sync
    // channel alive.
    const popup = window.open(
      builderUrl,
      SYNCED_BUILDER_WINDOW_NAME,
      "width=1200,height=900",
    );
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
    <Box
      bg="bg.subtle"
      borderRadius="md"
      padding={4}
      border="1px solid"
      borderColor="border"
    >
      <VStack align="stretch" gap={3}>
        <VStack align="stretch" gap={1}>
          <Text textStyle="sm" fontWeight="semibold">
            Preview in Slack's Block Kit Builder
          </Text>
          <Text textStyle="xs" color="fg.muted">
            {blockCount === 1
              ? "1 block ready to preview."
              : `${blockCount} blocks ready to preview.`}{" "}
            Block Kit renders differently than plain text, so preview where it
            will run.
          </Text>
        </VStack>
        <HStack gap={2} align="center" flexWrap="wrap">
          <Tooltip
            content="Preview your blocks in Slack's Block Kit Builder. Opens once in a new tab."
            positioning={{ placement: "top" }}
          >
            <Button
              size="sm"
              colorPalette="orange"
              variant="outline"
              onClick={openOnce}
            >
              <ExternalLink size={14} /> Open in Block Kit Builder
            </Button>
          </Tooltip>
          <Tooltip
            content="Live preview in Slack's Block Kit Builder. Updates as you edit."
            positioning={{ placement: "top" }}
          >
            <Button
              size="sm"
              colorPalette="orange"
              variant="solid"
              onClick={openSynced}
            >
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
 * content (no fixed height, no resize handle) and runs the rendered text
 * through `<Markdown>` so bold/italic/links/blockquotes look like the
 * real Slack message — close enough to be useful, far less effort than
 * approximating Slack's chrome.
 */
function SlackTextPreviewCard({ text }: { text: string }) {
  const asMarkdown = useMemo(() => slackMrkdwnToCommonMark(text), [text]);
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      overflow="hidden"
      bg="bg.panel"
    >
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
          <SiSlack size={12} />
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
          — how this message will appear in Slack
        </Text>
      </HStack>
      <Box padding={4}>
        <Markdown>{asMarkdown}</Markdown>
      </Box>
    </Box>
  );
}

/**
 * Translate Slack mrkdwn to CommonMark so we can render it through our
 * standard `<Markdown>` pipeline. Slack's flavour is close to Markdown but
 * not identical — single-asterisk bold, angle-bracket links, mixed-case
 * mentions — so we touch only the syntax that actually differs and let the
 * rest fall through to the Markdown renderer.
 *
 * Intentional non-goals: Slack user/channel mentions (`<@U123>`, `<#C123>`),
 * since the templates we render against don't produce them.
 */
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

