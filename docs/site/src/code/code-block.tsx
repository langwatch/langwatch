import { Box, Flex, Text } from "@langwatch/design-system/primitives";
import { useState } from "react";
import { z } from "zod";

import { CodeBody, CopyAction, ExpandControl, sourceFromProps } from "./code-parts.tsx";
import { languageName } from "./languages.ts";

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
  const [expanded, setExpanded] = useState(false);
  if (source.lang === "mermaid") return <DocsMermaid {...props} />;
  const terminal = TERMINAL_LANGUAGES.includes(source.lang.toLowerCase());
  const title = source.title || (terminal ? "Terminal" : languageName({ lang: source.lang }));
  return (
    <CodeFrame>
      {source.title ? (
        <CodeBar>
          <Text
            as="span"
            flex="1"
            minWidth="0"
            fontSize="12px"
            lineHeight="20px"
            color="fg.muted"
            fontFamily={source.title ? "mono" : "body"}
          >
            {title}
          </Text>
          <CopyAction code={source.code} />
        </CodeBar>
      ) : (
        <Box className="docs-code-copy">
          <CopyAction code={source.code} />
        </Box>
      )}
      <CodeBody source={source} expanded={expanded} />
      <ExpandControl
        lines={source.lines.length}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />
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
      <details>
        <summary>View source</summary>
        <CodeFrame>
          <CodeBar>
            <Text as="span" flex="1" fontSize="12px">
              Mermaid
            </Text>
            <CopyAction code={source.code} />
          </CodeBar>
          <CodeBody source={plain} expanded />
        </CodeFrame>
      </details>
    </Box>
  );
}
