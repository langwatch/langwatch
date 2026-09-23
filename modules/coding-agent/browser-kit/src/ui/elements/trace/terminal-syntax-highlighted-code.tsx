import { Box } from "@chakra-ui/react";
import { codeToHtmlDark } from "@langwatch/design-system/shiki";
import { memo, useEffect, useState } from "react";

import { TERMINAL_FONT_STACK } from "../../../model/trace/terminal-palette.ts";
import { AnsiText } from "./terminal-ansi-text.tsx";

/**
 * Syntax-highlighted code for Read/Write output (editor-like, not terminal);
 * renders plain text while grammar loads, then swaps Shiki's HTML.
 */
export const SyntaxHighlightedCode = memo(function SyntaxHighlightedCode({
  code,
  filePath,
}: {
  code: string;
  /** Used only to guess the language from its extension. */
  filePath: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const extension = filePath.split(".").pop() ?? "";
    codeToHtmlDark({ code, lang: extension })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        // Grammar failed to load for some reason — plain text below already
        // covers this case, so there's nothing further to do.
      });
    return () => {
      cancelled = true;
    };
  }, [code, filePath]);

  if (html === null) return <AnsiText text={code} />;

  return (
    <Box
      fontFamily={TERMINAL_FONT_STACK}
      fontSize="13px"
      lineHeight="1.55"
      css={{
        "& .shiki, & .shiki pre": {
          background: "transparent !important",
          margin: 0,
          padding: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "inherit",
          fontSize: "inherit",
          lineHeight: "inherit",
        },
      }}
      // Shiki's own output — the highlighter escapes the source, this isn't
      // rendering arbitrary untrusted HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
