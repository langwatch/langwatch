import { Box, Code } from "@chakra-ui/react";
import React, { useMemo } from "react";

interface JsonViewerProps {
  data: unknown;
  maxHeight?: string;
  dimmed?: boolean;
}

const TOKEN_COLORS: Record<string, string> = {
  key: "#00f0ff",
  string: "#00ff41",
  number: "#ffaa00",
  boolean: "#ff00ff",
  null: "#ff0033",
  punctuation: "#4a6a7a",
};

function syntaxHighlight(json: string): React.ReactElement[] {
  const lines = json.split("\n");
  return lines.map((line, i) => {
    const parts: React.ReactElement[] = [];
    let remaining = line;
    let partIndex = 0;

    // Leading whitespace
    const indentMatch = remaining.match(/^(\s*)/);
    if (indentMatch?.[1]) {
      parts.push(<span key={partIndex++}>{indentMatch[1]}</span>);
      remaining = remaining.slice(indentMatch[1].length);
    }

    while (remaining.length > 0) {
      // Key (quoted string followed by colon)
      const keyMatch = remaining.match(/^"([^"\\]|\\.)*"\s*:/);
      if (keyMatch) {
        const keyPart = keyMatch[0].slice(0, -1).trimEnd();
        parts.push(
          <span key={partIndex++} style={{ color: TOKEN_COLORS.key }}>{keyPart}</span>
        );
        remaining = remaining.slice(keyPart.length);
        // colon + whitespace
        const colonMatch = remaining.match(/^[\s:]+/);
        if (colonMatch) {
          parts.push(
            <span key={partIndex++} style={{ color: TOKEN_COLORS.punctuation }}>{colonMatch[0]}</span>
          );
          remaining = remaining.slice(colonMatch[0].length);
        }
        continue;
      }

      // String value
      const strMatch = remaining.match(/^"([^"\\]|\\.)*"/);
      if (strMatch) {
        parts.push(
          <span key={partIndex++} style={{ color: TOKEN_COLORS.string }}>{strMatch[0]}</span>
        );
        remaining = remaining.slice(strMatch[0].length);
        continue;
      }

      // Number
      const numMatch = remaining.match(/^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/);
      if (numMatch) {
        parts.push(
          <span key={partIndex++} style={{ color: TOKEN_COLORS.number }}>{numMatch[0]}</span>
        );
        remaining = remaining.slice(numMatch[0].length);
        continue;
      }

      // Boolean / null
      const kwMatch = remaining.match(/^(true|false|null)/);
      if (kwMatch) {
        const color = kwMatch[0] === "null" ? TOKEN_COLORS.null : TOKEN_COLORS.boolean;
        parts.push(
          <span key={partIndex++} style={{ color }}>{kwMatch[0]}</span>
        );
        remaining = remaining.slice(kwMatch[0].length);
        continue;
      }

      // Punctuation
      if (/^[{}\[\],]/.test(remaining)) {
        parts.push(
          <span key={partIndex++} style={{ color: TOKEN_COLORS.punctuation }}>{remaining[0]}</span>
        );
        remaining = remaining.slice(1);
        continue;
      }

      // Anything else
      parts.push(<span key={partIndex++}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    }

    return (
      <div key={i} style={{ minHeight: "1.3em" }}>
        {parts.length > 0 ? parts : "\u00A0"}
      </div>
    );
  });
}

export function JsonViewer({ data, maxHeight = "400px", dimmed = false }: JsonViewerProps) {
  const highlighted = useMemo(() => {
    const json = JSON.stringify(data, null, 2);
    return syntaxHighlight(json);
  }, [data]);

  return (
    <Box
      maxH={maxHeight}
      overflowY="auto"
      bg="surface.code"
      borderRadius="2px"
      p={2}
      opacity={dimmed ? 0.5 : 1}
      css={{
        "&::-webkit-scrollbar": { width: "6px" },
        "&::-webkit-scrollbar-track": { background: "transparent" },
        "&::-webkit-scrollbar-thumb": { background: "rgba(0, 240, 255, 0.2)", borderRadius: "3px" },
      }}
    >
      <Code
        display="block"
        whiteSpace="pre"
        bg="transparent"
        color="text.primary"
        fontSize="xs"
        lineHeight="1.4"
        fontFamily="mono"
      >
        {highlighted}
      </Code>
    </Box>
  );
}
