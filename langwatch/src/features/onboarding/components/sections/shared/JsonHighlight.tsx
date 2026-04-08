import { Box } from "@chakra-ui/react";
import { Highlight, Prism } from "prism-react-renderer";
import type React from "react";
import type { PrismTheme } from "prism-react-renderer";
import { useColorMode } from "~/components/ui/color-mode";

const lightTheme: PrismTheme = {
  plain: { color: "#24292e", backgroundColor: "transparent" },
  styles: [
    { types: ["property"], style: { color: "#005cc5" } },
    { types: ["string", "attr-value"], style: { color: "#032f62" } },
    { types: ["number", "boolean", "null"], style: { color: "#e36209" } },
    { types: ["punctuation", "operator"], style: { color: "#24292e" } },
  ],
};

const darkTheme: PrismTheme = {
  plain: { color: "#e1e4e8", backgroundColor: "transparent" },
  styles: [
    { types: ["property"], style: { color: "#79b8ff" } },
    { types: ["string", "attr-value"], style: { color: "#9ecbff" } },
    { types: ["number", "boolean", "null"], style: { color: "#ffab70" } },
    { types: ["punctuation", "operator"], style: { color: "#e1e4e8" } },
  ],
};

export function JsonHighlight({
  code,
}: {
  code: string;
}): React.ReactElement {
  const { colorMode } = useColorMode();
  const theme = colorMode === "dark" ? darkTheme : lightTheme;

  return (
    <Highlight prism={Prism} theme={theme} code={code} language="json">
      {({ tokens, getLineProps, getTokenProps }) => (
        <Box
          as="pre"
          px={5}
          py={4}
          pr={12}
          fontSize="12.5px"
          fontFamily="'Geist Mono', 'IBM Plex Mono', 'Source Code Pro', Menlo, monospace"
          lineHeight="1.8"
          overflowX="hidden"
          whiteSpace="pre-wrap"
          wordBreak="break-all"
          letterSpacing="0.01em"
          bg="transparent"
        >
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </Box>
      )}
    </Highlight>
  );
}
