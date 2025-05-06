import { Highlight, Prism } from "prism-react-renderer";
import { Box, IconButton } from "@chakra-ui/react";
import { monokaiTheme } from "./monokaiTheme";
import { CopyIcon } from "lucide-react";
import { toaster } from "../ui/toaster";

(typeof global !== "undefined" ? global : window).Prism = Prism;
require("prismjs/components/prism-bash");
require("prismjs/components/prism-python");

export const RenderCode = ({
  code,
  language,
  style: propsStyle = {},
}: {
  code: string;
  language: string;
  style?: React.CSSProperties;
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

  return (
    <Box position="relative" className="group">
      <IconButton
        aria-label="Copy code"
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
      <Highlight
        prism={Prism}
        theme={monokaiTheme}
        code={code}
        language={language}
      >
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre style={{ ...style, whiteSpace: "pre-wrap", ...propsStyle }}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </Box>
  );
};
