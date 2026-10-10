import { Check, Clipboard, Copy, Eye, EyeOff, WandSparkles } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";

import { useColorMode } from "../../color-mode/index.tsx";
import {
  Box,
  Button,
  ClientOnly,
  CodeBlock,
  HStack,
  Icon,
  IconButton,
  Text,
} from "../../primitives.ts";
import {
  codeToHtml,
  codeToHtmlDark,
  ensureShikiLangLoaded,
  isShikiLangReady,
  normalizeShikiLang,
  useShikiAdapter,
} from "../../shiki-adapter.ts";
import { type DiffLineKind, parseUnifiedDiff } from "../../unified-diff.ts";
import { useCopyToClipboard } from "../../use-copy-to-clipboard.ts";
import { toaster } from "../overlays/toaster.tsx";
import { Tooltip } from "../overlays/tooltip.tsx";

interface CodePreviewProps {
  code: string;
  language: string;
  /** Shown in the window's title bar; defaults to the language. */
  filename?: string;
  /** Caps a tall snippet and scrolls it, keeping the title bar in view. */
  maxHeight?: string;
  /**
   * Reads `code` as a unified diff: a `+`/`-` column, added and removed lines tinted,
   * each line highlighted as `language`. Copy still writes the diff.
   */
  diff?: boolean;
  /** A gutter of line numbers; a diff numbers its old and new lines side by side. */
  lineNumbers?: boolean;
  /** Light chrome for a detail panel: small title, quiet border, 12px soft-wrapped body. */
  compact?: boolean;
  /**
   * Whether long lines wrap; defaults to `compact`. A wrapped line continues indented under
   * its own start, so code keeps its shape. Off, the body scrolls sideways.
   */
  wrap?: boolean;
}

const COMPACT_BODY = {
  "& pre": { margin: 0, padding: "8px 12px", fontSize: "12px", lineHeight: "18px" },
} as const;

/** Soft wrap with a hanging indent: a continuation sits under its line, never at column 0. */
const wrappedBody = ({ guttered }: { guttered: boolean }) =>
  ({
    "& pre": { whiteSpace: "pre-wrap", wordBreak: "break-word" },
    "& .line": {
      display: "inline-block",
      width: "100%",
      paddingInlineStart: guttered ? "calc(16px + 4ch)" : "4ch",
      textIndent: "-4ch",
    },
  }) as const;

/** The window's frame: a full title bar, or a detail panel's quiet 28px strip. */
const WINDOW_CHROME = {
  root: { borderRadius: "xl", borderColor: "border.nested" },
  strip: { paddingY: 1, borderBottomWidth: "1px" },
  title: {},
  copy: {},
} as const;
const COMPACT_CHROME = {
  root: { borderRadius: "4px", borderColor: "border.muted" },
  strip: { paddingY: 0, height: "28px", borderBottomWidth: 0 },
  title: { lineHeight: "18px", fontWeight: "medium", color: "fg.muted" },
  copy: { boxSize: "24px", minWidth: "24px" },
} as const;

/** One gutter string per line, drawn by CSS so selecting the code never takes it. */
function gutters({
  code,
  diff,
  lineNumbers,
}: {
  code: string;
  diff: boolean;
  lineNumbers: boolean;
}): { body: string; lines: { kind: DiffLineKind; gutter: string }[] } {
  if (!diff) {
    const count = code.split("\n").length;
    const width = String(count).length;
    return {
      body: code,
      lines: Array.from({ length: count }, (_, index) => ({
        kind: "context",
        gutter: lineNumbers ? `${String(index + 1).padStart(width)}  ` : "",
      })),
    };
  }
  const parsed = parseUnifiedDiff(code);
  const width = String(
    Math.max(1, ...parsed.flatMap((line) => [line.oldLine ?? 0, line.newLine ?? 0])),
  ).length;
  const cell = (n: number | null) => (n === null ? "" : String(n)).padStart(width);
  const mark = { add: "+", remove: "-", context: " ", hunk: " ", meta: " " } as const;
  return {
    body: parsed.map((line) => line.text).join("\n"),
    lines: parsed.map((line) => ({
      kind: line.kind,
      gutter: `${lineNumbers ? `${cell(line.oldLine)} ${cell(line.newLine)} ` : ""}${mark[line.kind]} `,
    })),
  };
}

const GUTTERED = {
  "& pre": { paddingInline: 0 },
  "& pre code": { display: "inline-block", minWidth: "100%" },
  "& .line": { display: "inline-block", width: "100%", paddingInline: "16px" },
  "& .line::before": {
    content: "attr(data-gutter)",
    whiteSpace: "pre",
    color: "fg.subtle",
    userSelect: "none",
  },
  "& .line[data-diff=add]": { background: "green.subtle" },
  "& .line[data-diff=add]::before": { color: "green.fg" },
  "& .line[data-diff=remove]": { background: "red.subtle" },
  "& .line[data-diff=remove]::before": { color: "red.fg" },
  "& .line[data-diff=hunk]": { background: "blue.subtle" },
  "& .line[data-diff=hunk] span, & .line[data-diff=meta] span": { color: "fg.muted !important" },
} as const;

/** The body's styles: the window's own ground, as SnippetPreview's, not the Shiki theme's. */
const bodyCss = ({
  compact,
  wrap,
  guttered,
}: {
  compact: boolean;
  wrap: boolean;
  guttered: boolean;
}) => ({
  "& pre": {
    margin: 0,
    padding: "12px 16px",
    whiteSpace: "pre",
    overflowX: "auto",
    tabSize: 4,
    background: "transparent !important",
  },
  ...(compact ? COMPACT_BODY : {}),
  ...(guttered ? GUTTERED : {}),
  ...(wrap ? wrappedBody({ guttered }) : {}),
});

/** One house window for every code sample: title bar, copy button, Shiki body. */
export function CodePreview({
  code,
  language,
  filename,
  maxHeight,
  diff = false,
  lineNumbers = false,
  compact = false,
  wrap = compact,
}: CodePreviewProps): React.ReactElement | null {
  const { colorMode } = useColorMode();
  const { copied, copy } = useCopyToClipboard();
  const [highlighted, setHighlighted] = useState<{ key: string; html: string } | null>(null);
  const guttered = diff || lineNumbers;
  const key = `${colorMode}\u0000${language}\u0000${diff}\u0000${lineNumbers}\u0000${code}`;

  useEffect(() => {
    let cancelled = false;
    const highlight = colorMode === "dark" ? codeToHtmlDark : codeToHtml;
    const { body, lines } = gutters({ code, diff, lineNumbers });
    const lineData = guttered
      ? (line: number) => {
          const at = lines[line - 1];
          return at ? { diff: at.kind, gutter: at.gutter } : undefined;
        }
      : undefined;
    void highlight({ code: body, lang: language, lineData }).then((html) => {
      if (!cancelled) setHighlighted({ key, html });
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, colorMode, key, diff, lineNumbers, guttered]);

  if (!code) return null;
  const html = highlighted?.key === key ? highlighted.html : null;
  const chrome = compact ? COMPACT_CHROME : WINDOW_CHROME;

  return (
    <Box
      border="1px solid"
      bg="bg.nested"
      {...chrome.root}
      overflow="hidden"
      width="full"
      minWidth={0}
    >
      <HStack justify="space-between" paddingX={3} {...chrome.strip}>
        <Text fontSize="xs" {...chrome.title}>
          {filename ?? (diff ? `${language} diff` : language)}
        </Text>
        <IconButton
          size="2xs"
          {...chrome.copy}
          variant="ghost"
          aria-label={copied ? "Copied" : "Copy code"}
          onClick={() => copy(code)}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </HStack>
      <Box overflow="auto" maxHeight={maxHeight} css={bodyCss({ compact, wrap, guttered })}>
        {html ? (
          <Box display="contents" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <Box
            as="pre"
            margin={0}
            padding={compact ? "8px 12px" : "12px 16px"}
            whiteSpace={wrap ? "pre-wrap" : "pre"}
            overflowX="auto"
            style={{ tabSize: 4 }}
          >
            {code}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** `sk-lw-abcdef123` reads `sk-l***...***123` until the reader asks to see it. */
export function maskSecret({ code, secret }: { code: string; secret: string }): string {
  return code.replaceAll(secret, `${secret.slice(0, 4)}***...***${secret.slice(-3)}`);
}

/** Writes to the clipboard and says so in a toast, as every setup snippet always has. */
async function copyWithToast({ text, what }: { text: string; what: string }): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toaster.create({
      title: "Copied",
      description: `${what} copied to clipboard`,
      type: "success",
    });
    return true;
  } catch {
    toaster.create({
      title: "Failed to copy",
      description: "Couldn't copy. Please try again.",
      type: "error", // no-raw-error-toast-ok
    });
    return false;
  }
}

/** How a snippet writes to the clipboard and announces it; resolves whether it worked. */
export type SnippetCopy = (request: { text: string; what: string }) => Promise<boolean>;

/** Copies the real text, never the masked one on screen. */
function SnippetCopyButton({
  text,
  label,
  copyText,
}: {
  text: string;
  label: string;
  copyText: SnippetCopy;
}) {
  const [copied, setCopied] = useState(false);
  const name = `Copy ${label.toLowerCase()}`;
  const copy = async (value: string) => {
    if (!(await copyText({ text: value, what: label }))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Tooltip content={copied ? "Copied!" : name} openDelay={0} showArrow>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => void copy(text)}
        aria-label={name}
        colorPalette={copied ? "green" : "gray"}
        borderRadius="lg"
        flexShrink={0}
      >
        {copied ? <Check size={14} /> : <Clipboard size={14} />}
      </Button>
    </Tooltip>
  );
}

function SnippetAction({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Tooltip content={label} openDelay={0} showArrow>
      <IconButton
        size="2xs"
        variant="ghost"
        onClick={onClick}
        aria-label={label}
        data-testid={testId}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

/** A capped snippet scrolls its own body under a header that stays put; uncapped, it grows. */
function cappedLayout({ maxHeight }: { maxHeight?: string }) {
  if (!maxHeight) return { root: {}, header: {}, content: { overflow: "scroll" } } as const;
  return {
    root: { maxHeight, display: "flex", flexDirection: "column" },
    header: { flexShrink: 0 },
    content: { overflow: "auto", minHeight: 0 },
  } as const;
}

/** The header's actions: reveal, copy an LLM prompt, copy the snippet. */
function SnippetActions({
  isVisible,
  onToggleVisibility,
  llmPrompt,
  copy,
  copyText,
  filename,
  testId,
}: {
  isVisible: boolean;
  onToggleVisibility?: () => void;
  llmPrompt?: string;
  copy: SnippetCopy;
  copyText: string;
  filename: string;
  testId?: string;
}) {
  const visibilityLabel = isVisible ? "Hide sensitive values" : "Show sensitive values";
  return (
    <HStack gap="0" marginRight="-3px">
      {onToggleVisibility ? (
        <SnippetAction
          label={visibilityLabel}
          testId={testId ? `${testId}-visibility-toggle` : undefined}
          onClick={onToggleVisibility}
        >
          {isVisible ? <EyeOff /> : <Eye />}
        </SnippetAction>
      ) : null}
      {llmPrompt ? (
        <SnippetAction
          label="Copy LLM-optimized integration prompt"
          onClick={() => void copy({ text: llmPrompt, what: "Integration prompt" })}
        >
          <WandSparkles />
        </SnippetAction>
      ) : null}
      <SnippetCopyButton text={copyText} label={filename} copyText={copy} />
    </HStack>
  );
}

export interface SnippetPreviewProps {
  code: string;
  filename: string;
  codeLanguage: string;
  highlightLines?: number[];
  languageIconUrl?: string;
  /** Masked in the rendered snippet until revealed; never what the copy button writes. */
  sensitiveValue?: string;
  enableVisibilityToggle?: boolean;
  isVisible?: boolean;
  onToggleVisibility?: () => void;
  /** A second copy action: an LLM-ready prompt describing the integration. */
  llmPrompt?: string;
  /** What the copy button writes regardless of reveal state; defaults to the unmasked code. */
  copyText?: string;
  /** Hides every header action, for placeholders that would copy into a failing command. */
  disableActions?: boolean;
  /** Caps tall snippets while keeping the header and its actions in view. */
  maxHeight?: string;
  /** The owner's clipboard seam (a host's copy and notice); defaults to a design-system toast. */
  copy?: SnippetCopy;
  testId?: string;
}

/**
 * A setup snippet that may carry a credential: masked until revealed, copied unmasked, on the
 * glass code block the onboarding and key screens share. Plain samples use `CodePreview`.
 */
export function SnippetPreview({
  code,
  filename,
  codeLanguage,
  highlightLines,
  languageIconUrl,
  sensitiveValue,
  enableVisibilityToggle,
  isVisible: controlledIsVisible,
  onToggleVisibility,
  llmPrompt,
  copyText,
  disableActions,
  maxHeight,
  copy = copyWithToast,
  testId,
}: SnippetPreviewProps): React.ReactElement | null {
  const { colorMode } = useColorMode();
  const shikiAdapter = useShikiAdapter(colorMode);
  const lang = normalizeShikiLang(codeLanguage);
  const [langReady, setLangReady] = useState(() => isShikiLangReady(lang));
  useEffect(() => {
    if (!langReady) void ensureShikiLangLoaded(lang).then(() => setLangReady(true));
  }, [lang, langReady]);
  const [internalIsVisible, setInternalIsVisible] = useState(false);
  const isVisible = controlledIsVisible ?? internalIsVisible;
  const masks = sensitiveValue !== undefined && !isVisible && code.includes(sensitiveValue);
  const displayCode = masks ? maskSecret({ code, secret: sensitiveValue }) : code;
  const toggleVisibility = onToggleVisibility ?? (() => setInternalIsVisible(!isVisible));
  const layout = cappedLayout({ maxHeight });

  if (!code) return null;

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <ClientOnly>
        {() => (
          <CodeBlock.Root
            size="sm"
            colorPalette="orange"
            code={displayCode}
            data-testid={testId}
            language={langReady ? codeLanguage : "text"}
            meta={{ highlightLines, colorScheme: colorMode }}
            transition="all 0.3s ease"
            borderRadius="xl"
            border="1px solid"
            borderColor="border.nested"
            bg="bg.nested"
            boxShadow="0 4px 30px rgba(0,0,0,0.06)"
            {...layout.root}
            overflow="hidden"
          >
            <CodeBlock.Header
              display="flex"
              justifyContent="space-between"
              borderColor="border.nested"
              {...layout.header}
            >
              <CodeBlock.Title fontSize="xs" paddingTop={2}>
                {languageIconUrl ? (
                  <Icon size="xs">
                    <img src={languageIconUrl} alt={filename} />
                  </Icon>
                ) : null}
                {filename}
              </CodeBlock.Title>
              {disableActions ? null : (
                <SnippetActions
                  isVisible={isVisible}
                  onToggleVisibility={enableVisibilityToggle ? toggleVisibility : undefined}
                  llmPrompt={llmPrompt}
                  copy={copy}
                  copyText={copyText ?? code}
                  filename={filename}
                  testId={testId}
                />
              )}
            </CodeBlock.Header>
            <CodeBlock.Content
              transition="background-color 0.3s ease, color 0.3s ease"
              {...layout.content}
            >
              <CodeBlock.Code>
                <CodeBlock.CodeText />
              </CodeBlock.Code>
            </CodeBlock.Content>
          </CodeBlock.Root>
        )}
      </ClientOnly>
    </CodeBlock.AdapterProvider>
  );
}
