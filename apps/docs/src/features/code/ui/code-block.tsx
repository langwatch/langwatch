import { Box, Flex, Text } from "@langwatch/design-system/primitives";
import { FileCode, Terminal } from "lucide-react";
import { z } from "zod";

import { CodeBody, CopyAction, sourceFromProps } from "./code-parts.tsx";
import { codeFilename, languageName } from "./languages.ts";

const TERMINAL_LANGUAGES = ["bash", "sh", "shell", "zsh", "console", "terminal", "shellscript"];

export function CodeFrame({ children }: { children: React.ReactNode }) {
  return (
    <Box
      className="docs-code-frame"
      marginY="6"
      borderWidth="1px"
      borderColor="border.nested"
      bg="bg.nested"
      borderRadius="showcase"
      overflow="hidden"
      minWidth="0"
    >
      {children}
    </Box>
  );
}

export function CodeBar({ children }: { children: React.ReactNode }) {
  return (
    <Flex
      alignItems="center"
      gap="2"
      minHeight="44px"
      paddingX="3"
      bg="bg.subtle"
      borderBottomWidth="1px"
      borderColor="border.nested"
    >
      {children}
    </Flex>
  );
}

/** A single fenced block: the pre-highlighted lines in a titled, copyable frame. */
export function DocsCodeBlock(props: Record<string, unknown>) {
  const source = sourceFromProps(props);
  if (source.lang === "mermaid") return <DocsMermaid {...props} />;
  const terminal = TERMINAL_LANGUAGES.includes(source.lang.toLowerCase());
  const title = codeFilename(source);
  return (
    <CodeFrame>
      <CodeBar>
        {terminal ? (
          <Terminal size={16} aria-hidden="true" />
        ) : (
          <FileCode size={16} aria-hidden="true" />
        )}
        <Text as="span" flex="1" minWidth="0" fontSize="12px" fontFamily="mono">
          {title}
        </Text>
        <Text as="span" fontSize="12px" color="fg.muted">
          {languageName({ lang: source.lang })}
        </Text>
        <CopyAction code={source.code} />
      </CodeBar>
      <CodeBody source={source} />
    </CodeFrame>
  );
}

/** Both diagrams are built with the page; theme changes require no client renderer. */
function DocsMermaid(props: Record<string, unknown>) {
  const source = sourceFromProps(props);
  const plain = {
    ...source,
    lines: source.code.split("\n").map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;")),
  };
  return (
    <Box
      as="figure"
      marginY="6"
      marginX="0"
      aria-label="Diagram. A text version is available in View source."
    >
      <Box className="docs-mermaid">
        <div
          className="docs-light-only"
          dangerouslySetInnerHTML={{
            __html: z.string().default("").parse(props["data-diagram-light"]),
          }}
        />
        <div
          className="docs-dark-only"
          dangerouslySetInnerHTML={{
            __html: z.string().default("").parse(props["data-diagram-dark"]),
          }}
        />
      </Box>
      <details className="docs-disclosure">
        <summary>View source</summary>
        <CodeFrame>
          <CodeBar>
            <Text as="span" flex="1" fontSize="12px">
              Mermaid
            </Text>
            <CopyAction code={source.code} />
          </CodeBar>
          <CodeBody source={plain} />
        </CodeFrame>
      </details>
    </Box>
  );
}
