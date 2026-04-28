import { createShikiAdapter } from "@chakra-ui/react";
import { useMemo } from "react";
import { createHighlighter, type HighlighterGeneric } from "shiki";

export function useShikiAdapter(colorMode: string) {
  return useMemo(() => {
    return createShikiAdapter<HighlighterGeneric<any, any>>({
      async load() {
        return createHighlighter({
          langs: [
            "markdown",
            "json",
            "bash",
            "typescript",
            "python",
            "xml",
            "html",
            "yaml",
          ],
          themes: ["github-dark", "github-light"],
        });
      },
      theme: colorMode === "dark" ? "github-dark" : "github-light",
    });
  }, [colorMode]);
}
