import { Box } from "@chakra-ui/react";
import { memo, useEffect, useState } from "react";
import { codeToHtmlDark } from "../markdownView/shikiAdapter";
import { AnsiText } from "./AnsiText";
import { TERMINAL_FONT_STACK } from "./palette";

/**
 * A file's content, syntax-highlighted the way an editor would show it — not
 * plain terminal text. Used for Read/Write output specifically (a real file,
 * with a real extension), not for Bash stdout, which usually isn't code in
 * any one language.
 *
 * Renders plain (unhighlighted) text while the grammar loads, then swaps in
 * Shiki's HTML once ready. Shiki's own theme background is stripped so the
 * highlighted block sits flush on the terminal's own near-black screen
 * rather than carrying its own panel.
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
