/**
 * ShikiCommandBox — a PostHog-style syntax-highlighted command box.
 *
 * Replaces both `CodeBlock.tsx` and the inline `QuickCommand` component
 * inside `TokenCreatedDialog` with one unified surface:
 *
 *  - Syntax-highlighted via the shared Shiki singleton (github-light theme).
 *  - Memoises token streams for both the masked and unmasked form; re-tokenises
 *    only when `command`, `maskedCommand`, or `lang` changes.
 *  - Masked/unmasked reveal toggle (eye icon).
 *  - Copy button with 1s success-flash and a "Copied" toaster announcement.
 *  - Optional `>_` terminal prompt glyph rendered via a CSS pseudo-element
 *    overlay — NOT part of the source string passed to Shiki or the clipboard.
 *  - Horizontal scroll; never wraps or truncates.
 *  - Visual distinction of credential tokens is provided by Shiki's bash
 *    tokenization: the `--api-key` flag and its value render as visually
 *    distinct tokens via the github-light theme. No regex decoration pass.
 *
 * @see specs/api-keys/token-created-snippets.feature
 */

import { Box, HStack, IconButton, Spacer } from "@chakra-ui/react";
import { Check, Clipboard, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { copyToClipboard } from "~/features/onboarding/components/sections/shared/copy-to-clipboard";
import { codeToHtml } from "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter";

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

export interface ShikiCommandBoxProps {
  /**
   * The command / code to display and copy (unmasked form — the real value).
   * This is also passed to `codeToHtml` for Shiki tokenisation.
   */
  command: string;

  /**
   * Optional masked form of the command (e.g. with the API key replaced by
   * `pat-lw-…`). When provided:
   *   - The masked form is shown by default.
   *   - An eye toggle appears to reveal/hide the real command.
   *   - Both forms are pre-tokenised at mount; toggling swaps streams.
   * When omitted the real command is shown immediately with no eye toggle.
   */
  maskedCommand?: string;

  /**
   * Shiki language identifier. Use `"bash"` or `"shellscript"` for shell
   * commands, `"ini"` for `.env` blocks, `"json"` for config objects.
   */
  lang: string;

  /**
   * When `true`, renders a `>_` terminal prompt glyph to the left of the
   * command via a CSS pseudo-element/sibling overlay. The glyph is purely
   * presentational: it is NOT part of the Shiki source string and NOT
   * included in the clipboard value.
   */
  showPrompt?: boolean;

  /**
   * Label used in the copy button's accessible name and toaster message,
   * e.g. "Command", "Config".
   */
  copyLabel?: string;
}

// ---------------------------------------------------------------------------
// ShikiCommandBox component
// ---------------------------------------------------------------------------

/**
 * Syntax-highlighted command box with copy/reveal controls.
 *
 * Shiki tokenisation is performed asynchronously at mount. Both the masked
 * and unmasked HTML strings are pre-computed once; toggling reveal swaps
 * between the two pre-computed strings without calling `codeToHtml` again.
 *
 * The `>_` prompt glyph (when `showPrompt` is true) is rendered as a
 * sibling DOM node with `aria-hidden`; the Shiki source and clipboard
 * value are always the raw command without any prompt prefix.
 */
export function ShikiCommandBox({
  command,
  maskedCommand,
  lang,
  showPrompt = false,
  copyLabel = "Command",
}: ShikiCommandBoxProps): React.ReactElement {
  const hasReveal = Boolean(maskedCommand);
  const [revealed, setRevealed] = useState(!hasReveal);
  const [copied, setCopied] = useState(false);

  // Pre-computed Shiki HTML strings (null while loading).
  // We use refs so toggling never re-triggers useEffect.
  const maskedHtmlRef = useRef<string | null>(null);
  const unmaskedHtmlRef = useRef<string | null>(null);
  const [htmlReady, setHtmlReady] = useState(false);

  // Ref for the reset-copied timer — cleared on unmount to avoid state
  // updates on an unmounted component.
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tokenise both forms whenever command/maskedCommand/lang changes.
  // At most 2 codeToHtml calls per stable input triple.
  useEffect(() => {
    let cancelled = false;
    setHtmlReady(false);

    async function tokenise(): Promise<void> {
      const [unmasked, masked] = await Promise.all([
        codeToHtml({ code: command, lang }),
        maskedCommand
          ? codeToHtml({ code: maskedCommand, lang })
          : Promise.resolve(null),
      ]);
      if (!cancelled) {
        unmaskedHtmlRef.current = unmasked;
        maskedHtmlRef.current = masked;
        setHtmlReady(true);
      }
    }

    void tokenise();
    return () => {
      cancelled = true;
    };
  }, [command, maskedCommand, lang]); // Re-tokenise only when inputs change

  // Clear the copied-reset timer on unmount.
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  // The HTML string to render now.
  const activeHtml: string | null = useMemo(() => {
    if (!htmlReady) return null;
    if (!hasReveal || revealed) return unmaskedHtmlRef.current;
    return maskedHtmlRef.current;
  }, [htmlReady, hasReveal, revealed]);

  // Copy the REAL (unmasked) command — never the prompt glyph.
  const handleCopy = (): void => {
    void copyToClipboard({
      text: command,
      successMessage: `${copyLabel} copied to clipboard`,
    }).then((success) => {
      if (success) {
        setCopied(true);
        if (copiedTimerRef.current !== null) {
          clearTimeout(copiedTimerRef.current);
        }
        copiedTimerRef.current = setTimeout(() => setCopied(false), 1000);
      }
    });
  };

  return (
    <Box
      position="relative"
      width="full"
      borderRadius="xl"
      border="1px solid"
      borderColor="border.subtle"
      bg="bg.panel/70"
      boxShadow="xs"
      overflow="hidden"
      transition="all 0.17s ease"
      _hover={{ borderColor: "orange.emphasized", boxShadow: "md" }}
    >
      {/* Header bar — copy + reveal controls */}
      <HStack
        paddingX={3}
        paddingY={1.5}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.subtle"
      >
        <Spacer />
        {hasReveal && (
          <IconButton
            aria-label={revealed ? "Hide secret values" : "Show secret values"}
            size="xs"
            variant="ghost"
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconButton>
        )}
        <IconButton
          aria-label={`Copy ${copyLabel.toLowerCase()}`}
          data-state={copied ? "copied" : "idle"}
          size="xs"
          variant="ghost"
          colorPalette={copied ? "green" : "gray"}
          onClick={handleCopy}
        >
          {copied ? <Check size={14} /> : <Clipboard size={14} />}
        </IconButton>
      </HStack>

      {/* Code area */}
      <HStack
        align="start"
        paddingX={3}
        paddingY={2}
        gap={0}
        overflow="hidden"
      >
        {/* Terminal prompt glyph — purely decorative, NOT in source string or clipboard */}
        {showPrompt && (
          <Box
            as="span"
            aria-hidden="true"
            flexShrink={0}
            fontFamily="mono"
            fontSize="xs"
            color="fg.muted"
            lineHeight="1.6"
            paddingRight={2}
            userSelect="none"
          >
            {">_"}
          </Box>
        )}

        {/* Shiki-highlighted code output or fallback pre */}
        <Box
          flex={1}
          overflowX="auto"
          data-shiki-box
          css={{
            "& pre": {
              margin: "0 !important",
              padding: "0 !important",
              background: "transparent !important",
              fontFamily:
                "'Geist Mono', 'IBM Plex Mono', 'Source Code Pro', Menlo, monospace",
              fontSize: "12.5px",
              lineHeight: "1.6",
              whiteSpace: "pre",
              overflowX: "auto",
            },
            "& code": {
              fontFamily: "inherit",
              fontSize: "inherit",
              background: "transparent !important",
            },
          }}
        >
          {activeHtml ? (
            // Shiki HTML is ready — render it
            <Box dangerouslySetInnerHTML={{ __html: activeHtml }} />
          ) : (
            // Fallback while Shiki loads — monospace plain text
            <Box
              as="pre"
              fontFamily="mono"
              fontSize="xs"
              margin={0}
              padding={0}
              color="fg"
            >
              {hasReveal && !revealed && maskedCommand
                ? maskedCommand
                : command}
            </Box>
          )}
        </Box>
      </HStack>
    </Box>
  );
}
