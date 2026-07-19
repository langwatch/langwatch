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
import { keyframes } from "@emotion/react";
import { Check, Clipboard, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { copyToClipboard } from "~/features/onboarding/components/sections/shared/copy-to-clipboard";
import { codeToHtml } from "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter";

// PostHog's rainbow-scroll keyframes, defined via Emotion's `keyframes`
// helper so the animation name is hoisted to a global stylesheet (Chakra's
// `css` prop doesn't reliably hoist nested `@keyframes`).
// Source: posthog/frontend/src/styles/base.scss:2100-2108
const lwRainbowScroll = keyframes`
  0% { background-position-x: 0%; }
  100% { background-position-x: 200%; }
`;

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

  /**
   * When `true`, paints a slow-sweeping rainbow gradient sheen across the
   * code area (PostHog-style "wizard" command shimmer). The sheen is a
   * non-interactive `mix-blend-mode: screen` overlay — Shiki's syntax
   * colors stay readable underneath. Defaults to the value of `showPrompt`
   * (terminal commands shimmer; static `.env` / config blocks don't).
   * Respects `prefers-reduced-motion` and disables the animation when set.
   */
  animateRainbow?: boolean;
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
  animateRainbow,
}: ShikiCommandBoxProps): React.ReactElement {
  // Default the rainbow sheen on for terminal-prompt snippets — those are
  // the install/setup commands where a touch of motion adds delight.
  // Static blocks (.env, Authorization headers, JSON config) stay calm.
  const rainbowOn = animateRainbow ?? showPrompt;
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
      data-testid="shiki-command-box"
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

        {/* Shiki-highlighted code output or fallback pre.
            Outer Box owns horizontal scroll (overflow-x: auto). The inner
            `<pre>` keeps `white-space: pre` so the command doesn't wrap,
            and does NOT set its own overflow (a nested scroll container
            here would prevent the outer Box's scrollbar from triggering on
            long commands).
            When rainbowOn, PostHog's `.rainbow-text` recipe (verbatim from
            posthog/frontend/src/styles/base.scss:2070-2110) is applied to
            the wrapper: 5-stop gradient, background-clip: text,
            color: transparent, 3s background-position-x scroll. Nested
            `<pre>`/`<code>`/`<span>` inherit `color: transparent` so
            Shiki's inline per-token colors don't paint over the gradient.
            `@media (prefers-reduced-motion: reduce)` kills the animation. */}
        <Box
          flex={1}
          overflowX="auto"
          data-shiki-box
          data-rainbow={rainbowOn ? "on" : "off"}
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
              // Chakra's global preflight applies `overflow-wrap: break-word`
              // to <pre>, which wraps the long install command mid-string
              // (e.g. mid-API-key) regardless of `white-space: pre` — those
              // are orthogonal CSS axes. Forcing both back to `normal` lets
              // the pre's natural content width be the unbroken line length.
              overflowWrap: "normal !important",
              wordWrap: "normal !important",
              // Size strictly to the natural content width. For the long
              // Claude Code install command this is ~1500px; the wrapper's
              // 820px-wide flex slot then sees a wider child and engages
              // `overflow-x: auto`. `min-width: 100%` keeps the pre at least
              // as wide as the wrapper for short commands.
              width: "max-content",
              minWidth: "100%",
            },
            "& code": {
              fontFamily: "inherit",
              fontSize: "inherit",
              background: "transparent !important",
            },
            ...(rainbowOn && {
              color: "transparent",
              backgroundImage:
                "linear-gradient(90deg, #0143cb 0%, #2b6ff4 24%, #d23401 47%, #ff651f 66%, #fba000 83%, #0143cb 100%)",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundSize: "200% 100%",
              animation: `${lwRainbowScroll} 3s linear infinite`,
              // Force nested elements to inherit the transparent text-fill
              // so Shiki's inline per-token colours don't paint over the
              // wrapper's gradient text-fill. `!important` is required to
              // beat Shiki's inline `style="color:..."`.
              "& pre, & code, & span": {
                color: "inherit !important",
                WebkitTextFillColor: "inherit",
              },
              "@media (prefers-reduced-motion: reduce)": {
                animation: "none",
              },
            }),
          }}
        >
          {activeHtml ? (
            // Shiki HTML is ready — render it.
            // `display: contents` makes this intermediate host div invisible
            // to layout, so the wrapper Box sees the inner <pre> as its
            // direct child. Without it, this div is `display: block,
            // width: 100%`, hides the <pre>'s overflow from the wrapper,
            // and the wrapper's overflow-x: auto never engages even though
            // its scrollbar appears.
            <Box
              display="contents"
              dangerouslySetInnerHTML={{ __html: activeHtml }}
            />
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
