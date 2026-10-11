import { Card } from "@langwatch/design-system/card";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Box } from "@langwatch/design-system/primitives";
import { TYPE_SCALE_PX } from "@langwatch/design-system/typography";
import type * as MonacoApi from "monaco-editor";
import { lazy, Suspense } from "react";

import type { HttpBodyLanguage } from "../../model/http-body-language.ts";

type Monaco = typeof MonacoApi;

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

const URLENCODED_ID = "urlencoded";

/** Monaco has no form-encoded grammar: key, equals sign and value get their own colours. */
function registerUrlencoded(monaco: Monaco) {
  if (monaco.languages.getLanguages().some((language) => language.id === URLENCODED_ID)) return;
  monaco.languages.register({ id: URLENCODED_ID });
  monaco.languages.setMonarchTokensProvider(URLENCODED_ID, {
    tokenizer: {
      root: [
        [/\{\{[^}]*\}\}/, "variable"],
        [/[^=&{]+(?==)/, "keyword"],
        [/[=&]/, "delimiter"],
        [/[^&{]+/, "string"],
      ],
    },
  });
}

/** Monaco for the request body template; the highlight follows the Content-Type header. */
export function HttpBodyCodeEditor({
  value,
  onChange,
  language,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  language: HttpBodyLanguage;
  disabled?: boolean;
}) {
  const { colorMode } = useColorMode();
  return (
    <Box
      width="full"
      height="220px"
      display="flex"
      flexDirection="column"
      data-testid="body-template-editor"
    >
      <Card variant="frame-fill">
        <Box height="100%">
          <Suspense fallback={null}>
            <MonacoEditor
              height="100%"
              language={language}
              value={value}
              theme={colorMode === "dark" ? "vs-dark" : "vs"}
              beforeMount={registerUrlencoded}
              onChange={(next: string | undefined) => onChange(next ?? "")}
              options={{
                readOnly: disabled,
                minimap: { enabled: false },
                fontSize: TYPE_SCALE_PX.bodySm,
                scrollBeyondLastLine: false,
                lineNumbers: "off",
                wordWrap: "on",
                renderValidationDecorations: "off",
              }}
            />
          </Suspense>
        </Box>
      </Card>
    </Box>
  );
}
