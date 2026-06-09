import { Box, IconButton } from "@chakra-ui/react";
import { CopyIcon } from "lucide-react";
import { Highlight, Prism, type PrismTheme } from "prism-react-renderer";
import { toaster } from "../ui/toaster";
import { monokaiTheme } from "./monokaiTheme";

(typeof global !== "undefined" ? global : window).Prism = Prism;
// @ts-ignore — prismjs component modules lack type declarations
void import("prismjs/components/prism-bash");
// @ts-ignore — prismjs component modules lack type declarations
void import("prismjs/components/prism-python");
// @ts-ignore — prismjs component modules lack type declarations
void import("prismjs/components/prism-diff");

export const RenderCode = ({
  code,
  language,
  style: propsStyle = {},
  theme = monokaiTheme,
}: {
  code: string;
  language: string;
  style?: React.CSSProperties;
  /**
   * Override the prism theme. Defaults to monokai (dark) for backwards
   * compatibility with existing call sites; pass an explicit theme to follow
   * the user's color mode.
   */
  theme?: PrismTheme;
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
      <Highlight prism={Prism} theme={theme} code={code} language={language}>
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
