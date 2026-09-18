/**
 * A syntax-highlighted code block with a copy button, family-local (see
 * `platform/app/.../RenderCode.tsx`); it hands the copy outcome back rather
 * than toasting - a feature-web package may not reach a toaster singleton.
 */

import { Box, IconButton } from "@chakra-ui/react";
import { codeToHtml, codeToHtmlDark } from "@langwatch/design-system/shiki";
import { CopyIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

/** A resolved highlight, tagged with the inputs it was produced from. */
interface Highlighted {
  code: string;
  language: string;
  colorMode: "light" | "dark";
  html: string;
}

export const RenderCode = ({
  code,
  language,
  style: propsStyle = {},
  colorMode = "dark",
  onCopied,
  onCopyFailed,
}: {
  code: string;
  language: string;
  style?: CSSProperties;
  /**
   * Which Shiki theme to render with. Defaults to dark for backwards
   * compatibility with existing call sites; pass the app's own color mode to
   * follow it instead.
   */
  colorMode?: "light" | "dark";
  onCopied?: () => void;
  onCopyFailed?: () => void;
}) => {
  const handleCopy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => onCopied?.())
      .catch(() => onCopyFailed?.());
  };

  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);

  useEffect(() => {
    let cancelled = false;
    const highlight = colorMode === "dark" ? codeToHtmlDark : codeToHtml;
    void highlight({ code, lang: language }).then((html) => {
      if (!cancelled) setHighlighted({ code, language, colorMode, html });
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, colorMode]);

  // Tagged with its inputs and compared here, not cleared in the effect:
  // highlighting is async, so right after `code` changes the PREVIOUS
  // highlight is still in state - deriving "is this still current?" from
  // props avoids depending on effect or microtask ordering.
  const isCurrentHighlight =
    highlighted &&
    highlighted.code === code &&
    highlighted.language === language &&
    highlighted.colorMode === colorMode;
  const html = isCurrentHighlight ? highlighted.html : null;

  return (
    <Box position="relative" className="group" style={propsStyle}>
      <IconButton
        aria-label="Copy code"
        onClick={handleCopy}
        position="absolute"
        top={2}
        right={2}
        zIndex={1}
        opacity={0}
        _groupHover={{ opacity: 1 }}
      >
        <CopyIcon />
      </IconButton>
      {html ? (
        // `display: contents` keeps this host div invisible to layout so
        // Shiki's own <pre> is what callers' surrounding CSS sees.
        <Box
          display="contents"
          css={{ "& pre": { margin: 0, whiteSpace: "pre-wrap" } }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        // Fallback until the highlight for THIS code resolves — plain text.
        <Box as="pre" margin={0} whiteSpace="pre-wrap">
          {code}
        </Box>
      )}
    </Box>
  );
};
