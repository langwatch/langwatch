import { Box, IconButton } from "@chakra-ui/react";
import { CopyIcon } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  codeToHtml,
  codeToHtmlDark,
} from "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter";
import { toaster } from "../ui/toaster";

export const RenderCode = ({
  code,
  language,
  style: propsStyle = {},
  colorMode = "dark",
}: {
  code: string;
  language: string;
  style?: React.CSSProperties;
  /**
   * Which Shiki theme to render with. Defaults to dark for backwards
   * compatibility with existing call sites; pass the app's own color mode to
   * follow it instead.
   */
  colorMode?: "light" | "dark";
}) => {
  const handleCopy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        toaster.success({
          title: "Code copied",
        });
      })
      .catch(() => {
        toaster.error({
          title: "Failed to copy",
        });
      });
  };

  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const highlight = colorMode === "dark" ? codeToHtmlDark : codeToHtml;
    void highlight({ code, lang: language }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, colorMode]);

  return (
    <Box position="relative" className="group" style={propsStyle}>
      <IconButton
        aria-label="Copy code"
        // eslint-disable-next-line react/no-children-prop
        children={<CopyIcon />}
        onClick={handleCopy}
        position="absolute"
        top={2}
        right={2}
        zIndex={1}
        opacity={0}
        _groupHover={{
          opacity: 1,
        }}
      />
      {html ? (
        // `display: contents` keeps this host div invisible to layout so
        // Shiki's own <pre> is what callers' surrounding CSS sees.
        <Box
          display="contents"
          css={{ "& pre": { margin: 0, whiteSpace: "pre-wrap" } }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        // Fallback while Shiki loads — plain unhighlighted text.
        <Box as="pre" margin={0} whiteSpace="pre-wrap">
          {code}
        </Box>
      )}
    </Box>
  );
};
