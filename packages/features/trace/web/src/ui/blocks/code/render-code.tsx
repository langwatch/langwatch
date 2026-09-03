import { Box, IconButton } from "@chakra-ui/react";
import { CopyIcon } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { codeToHtml, codeToHtmlDark } from "@langwatch/trace-web";
import { toaster } from "@langwatch/design-system/toaster";

/** What a refused clipboard write says. Hoisted so its opt-out marker survives a reformat. */
const COPY_REFUSED = {
  title: "Couldn't copy the code",
  description: "Clipboard access is restricted. This can happen on non-HTTPS domains.",
};

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
        // STAYS ON THE DESIGN SYSTEM TOASTER. A `blocks/` element may not
        // depend upward on `behavior/`, which is where this package's failure
        // reporter lives, and a clipboard refusal is the one failure that can
        // afford the exemption: it has no code, never crosses a wire, and
        // nothing the presentation registry knows is given up.
        toaster.error(COPY_REFUSED); // no-raw-error-toast-ok
      });
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

  // Tagged with its inputs and compared here, rather than cleared inside the
  // effect: highlighting is async, so on the render right after `code` changes
  // the PREVIOUS highlight is still in state, and rendering it shows the
  // previous snippet — visible when switching language tabs. Deriving "is this
  // highlight still current?" from the props keeps the plain-text fallback
  // showing the right code until the new highlight lands, with no dependence
  // on effect or microtask ordering.
  const html =
    highlighted &&
    highlighted.code === code &&
    highlighted.language === language &&
    highlighted.colorMode === colorMode
      ? highlighted.html
      : null;

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
        // Fallback until the highlight for THIS code resolves — plain text.
        <Box as="pre" margin={0} whiteSpace="pre-wrap">
          {code}
        </Box>
      )}
    </Box>
  );
};
