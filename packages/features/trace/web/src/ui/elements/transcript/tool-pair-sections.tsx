import { Box, HStack, Text } from "@chakra-ui/react";
import { useMemo, type ReactNode } from "react";

type ToolArgumentDisplay =
  | { kind: "string"; text: string }
  | { kind: "primitive"; text: string }
  | { kind: "json"; text: string };

export function ToolPairSection({
  label,
  tone = "default",
  children,
}: {
  label: string;
  tone?: "default" | "error";
  children: ReactNode;
}) {
  return (
    <Box
      paddingX={2.5}
      paddingY={1.5}
      _notFirst={{ borderTopWidth: "1px", borderTopColor: "border.muted" }}
    >
      <Text
        textStyle="2xs"
        fontWeight="600"
        color={tone === "error" ? "red.fg" : "fg.subtle"}
        textTransform="uppercase"
        letterSpacing="0.06em"
        marginBottom={1}
      >
        {label}
      </Text>
      {children}
    </Box>
  );
}

export function ToolArgRow({ name, value }: { name: string; value: unknown }) {
  const valueDisplay = useMemo(() => describeToolArgument(value), [value]);

  return (
    <HStack align="flex-start" gap={2} minWidth={0}>
      <Text
        textStyle="2xs"
        fontFamily="mono"
        color="fg.subtle"
        fontWeight="500"
        flexShrink={0}
        minWidth="60px"
      >
        {name}
      </Text>
      <ToolArgumentValue display={valueDisplay} />
    </HStack>
  );
}

function describeToolArgument(value: unknown): ToolArgumentDisplay {
  if (value == null) {
    return { kind: "primitive", text: "null" };
  }

  if (typeof value === "string") {
    return { kind: "string", text: value };
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return { kind: "primitive", text: String(value) };
  }

  try {
    return { kind: "json", text: JSON.stringify(value, null, 2) };
  } catch {
    return { kind: "primitive", text: String(value) };
  }
}

function ToolArgumentValue({ display }: { display: ToolArgumentDisplay }) {
  if (display.kind === "string" && display.text.length < 120) {
    return (
      <Text
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        wordBreak="break-word"
        flex={1}
        minWidth={0}
      >
        {display.text}
      </Text>
    );
  }

  if (display.kind === "primitive") {
    return (
      <Text textStyle="xs" fontFamily="mono" color="fg" flex={1}>
        {display.text}
      </Text>
    );
  }

  return (
    <Box
      as="pre"
      textStyle="2xs"
      fontFamily="mono"
      color="fg"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      bg="bg.panel"
      borderRadius="sm"
      paddingX={2}
      paddingY={1}
      margin={0}
      maxHeight="400px"
      overflow="auto"
      flex={1}
      minWidth={0}
    >
      {display.text}
    </Box>
  );
}
