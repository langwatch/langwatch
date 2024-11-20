import { Highlight, Prism } from "prism-react-renderer";
import { monokaiTheme } from "./monokaiTheme";

(typeof global !== "undefined" ? global : window).Prism = Prism;
require("prismjs/components/prism-bash");
require("prismjs/components/prism-python");

export const RenderCode = ({
  code,
  language,
}: {
  code: string;
  language: string;
}) => {
  return (
    <Highlight
      prism={Prism}
      theme={monokaiTheme}
      code={code}
      language={language}
    >
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <pre style={{ ...style, whiteSpace: "pre-wrap" }}>
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
  );
};
