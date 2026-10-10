import { Check, Copy } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";

import { useColorMode } from "../../color-mode/index.tsx";
import { Box, HStack, IconButton, Text } from "../../primitives.ts";
import { codeToHtml, codeToHtmlDark } from "../../shiki-adapter.ts";
import { useCopyToClipboard } from "../../use-copy-to-clipboard.ts";

interface CodePreviewProps {
  code: string;
  language: string;
  /** Shown in the window's title bar; defaults to the language. */
  filename?: string;
  /** Caps a tall snippet and scrolls it, keeping the title bar in view. */
  maxHeight?: string;
}

/** One house window for every code sample: title bar, copy button, Shiki body. */
export function CodePreview({
  code,
  language,
  filename,
  maxHeight,
}: CodePreviewProps): React.ReactElement | null {
  const { colorMode } = useColorMode();
  const { copied, copy } = useCopyToClipboard();
  const [highlighted, setHighlighted] = useState<{ key: string; html: string } | null>(null);
  const key = `${colorMode}\u0000${language}\u0000${code}`;

  useEffect(() => {
    let cancelled = false;
    const highlight = colorMode === "dark" ? codeToHtmlDark : codeToHtml;
    void highlight({ code, lang: language }).then((html) => {
      if (!cancelled) setHighlighted({ key, html });
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, colorMode, key]);

  if (!code) return null;
  const html = highlighted?.key === key ? highlighted.html : null;

  return (
    <Box
      borderRadius="xl"
      border="1px solid"
      borderColor="border.emphasized"
      overflow="hidden"
      width="full"
    >
      <HStack justify="space-between" paddingX={3} paddingY={1} borderBottomWidth="1px">
        <Text fontSize="xs">{filename ?? language}</Text>
        <IconButton
          size="2xs"
          variant="ghost"
          aria-label={copied ? "Copied" : "Copy code"}
          onClick={() => copy(code)}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </HStack>
      <Box
        overflow="auto"
        maxHeight={maxHeight}
        css={{ "& pre": { margin: 0, padding: "12px 16px", whiteSpace: "pre", overflowX: "auto" } }}
      >
        {html ? (
          <Box display="contents" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <Box as="pre" margin={0} padding="12px 16px" whiteSpace="pre" overflowX="auto">
            {code}
          </Box>
        )}
      </Box>
    </Box>
  );
}
