import { Box, Heading, Link, Table, Text } from "@chakra-ui/react";
import type React from "react";
import { ShikiCodeBlock } from "./ShikiHighlight";
import { stripThinkingMarker, ThinkingText } from "./thinking";

/**
 * Markdown → Chakra components mapping. Each element is a real Chakra
 * component (`Heading`, `Text`, `Link`, `Table`, etc.) so typography,
 * spacing, and colors all flow from the theme — instead of being pinned by
 * raw CSS strings. Shiki keeps doing the syntax highlighting for fenced
 * code blocks; everything else is themable.
 */
export function buildMarkdownComponents(colorMode: string) {
  return {
    h1: ({ children }: { children?: React.ReactNode }) => (
      <Heading as="h1" size="md" marginTop={3} marginBottom={2}>
        {children}
      </Heading>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <Heading as="h2" size="xs" marginTop={4} marginBottom={1.5}>
        {children}
      </Heading>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <Heading as="h3" size="xs" marginTop={3} marginBottom={1}>
        {children}
      </Heading>
    ),
    h4: ({ children }: { children?: React.ReactNode }) => (
      <Heading as="h4" size="xs" marginTop={2} marginBottom={1}>
        {children}
      </Heading>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <Text textStyle="xs" lineHeight="1.7" marginBottom={2}>
        {children}
      </Text>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <Box as="ul" paddingLeft={5} marginBottom={2} listStyleType="disc">
        {children}
      </Box>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <Box as="ol" paddingLeft={5} marginBottom={2}>
        {children}
      </Box>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <Box as="li" textStyle="xs" lineHeight="1.6" marginBottom={0.5}>
        {children}
      </Box>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <Box
        as="blockquote"
        borderLeftWidth="3px"
        borderLeftColor="border.emphasized"
        paddingLeft={3}
        paddingY={1}
        marginY={2}
        color="fg.muted"
        fontStyle="italic"
      >
        {children}
      </Box>
    ),
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
      <Link href={href} color="blue.fg" textDecoration="underline">
        {children}
      </Link>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
      <Text as="strong" fontWeight="semibold" display="inline">
        {children}
      </Text>
    ),
    em: ({ children }: { children?: React.ReactNode }) => {
      // Thinking blocks are emitted as `*🧠 …*` — detect the leading
      // marker, strip it, and render through the shimmery `ThinkingText`
      // component. The marker stays in the underlying markdown source so
      // copy-paste still preserves the "this was a thinking block" signal.
      const stripped = stripThinkingMarker(children);
      if (stripped) return <ThinkingText>{stripped}</ThinkingText>;
      return (
        <Text as="em" fontStyle="italic" display="inline">
          {children}
        </Text>
      );
    },
    del: ({ children }: { children?: React.ReactNode }) => (
      <Text
        as="del"
        textDecoration="line-through"
        color="fg.muted"
        display="inline"
      >
        {children}
      </Text>
    ),
    hr: () => (
      <Box
        as="hr"
        borderTopWidth="1px"
        borderTopColor="border.muted"
        marginY={3}
      />
    ),
    table: ({ children }: { children?: React.ReactNode }) => (
      <Box overflowX="auto" marginY={2}>
        <Table.Root size="sm" variant="line">
          {children}
        </Table.Root>
      </Box>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <Table.Header>{children}</Table.Header>
    ),
    tbody: ({ children }: { children?: React.ReactNode }) => (
      <Table.Body>{children}</Table.Body>
    ),
    tr: ({ children }: { children?: React.ReactNode }) => (
      <Table.Row>{children}</Table.Row>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <Table.ColumnHeader>{children}</Table.ColumnHeader>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <Table.Cell>{children}</Table.Cell>
    ),
    code(props: {
      className?: string;
      children?: React.ReactNode;
      inline?: boolean;
    }) {
      const { className, children } = props;
      const match = /language-(\w+)/.exec(className ?? "");
      const lang = match ? match[1] : undefined;
      const code = String(children ?? "").replace(/\n$/, "");
      if (!lang) {
        return (
          <Text
            as="code"
            fontFamily="mono"
            fontSize="0.85em"
            paddingX={1}
            paddingY="1px"
            borderRadius="xs"
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border.muted"
            display="inline"
          >
            {children}
          </Text>
        );
      }
      return (
        <ShikiCodeBlock code={code} language={lang} colorMode={colorMode} />
      );
    },
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
}
