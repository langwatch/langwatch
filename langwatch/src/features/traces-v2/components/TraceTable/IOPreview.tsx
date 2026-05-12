import { Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, Bot, User, Wrench } from "lucide-react";
import type React from "react";
import { useDensityTokens } from "../../hooks/useDensityTokens";
import { useDensityStore } from "../../stores/densityStore";
import { formatPreview } from "../../utils/previewFormatter";
import { tryParseChat } from "./chatContent";

const VERTICAL_BAR = "\u2506";
const COMFORTABLE_LABEL_WIDTH = "60px";

interface IOPreviewProps {
  input: string | null;
  output: string | null;
}

export const IOPreview: React.FC<IOPreviewProps> = ({ input, output }) => {
  const density = useDensityStore((s) => s.density);
  if (density === "comfortable") {
    return <ComfortableIOPreview input={input} output={output} />;
  }
  return <CompactIOPreview input={input} output={output} />;
};

/**
 * Build the row data once per cell. `formatPreview` runs the unified
 * unwrap/strip/glyph pipeline; `tryParseChat` is still consulted for the
 * isChat/isTool flags that drive the role icon. Both are cheap (each does
 * one JSON.parse attempt on the same input).
 */
function buildRow(raw: string | null): {
  text: string;
  isChat: boolean;
  isTool: boolean;
} {
  if (raw === null) return { text: "", isChat: false, isTool: false };
  const parsed = tryParseChat(raw);
  const formatted = formatPreview(raw, { maxChars: 80 });
  return {
    text: formatted.text,
    isChat: parsed.isChat,
    isTool: parsed.isTool,
  };
}

const CompactIOPreview: React.FC<IOPreviewProps> = ({ input, output }) => {
  const tokens = useDensityTokens();
  return (
    <VStack align="start" gap={0.5} fontFamily="mono">
      {input !== null && (
        <CompactRow
          row={buildRow(input)}
          fontSize={tokens.ioFontSize}
          direction="input"
        />
      )}
      {output !== null && (
        <CompactRow
          row={buildRow(output)}
          fontSize={tokens.ioFontSize}
          direction="output"
        />
      )}
    </VStack>
  );
};

interface CompactRowProps {
  row: { text: string; isChat: boolean; isTool: boolean };
  fontSize: string;
  direction: "input" | "output";
}

const CompactRow: React.FC<CompactRowProps> = ({
  row,
  fontSize,
  direction,
}) => {
  const isInput = direction === "input";
  const accent = isInput ? "blue.fg" : "green.fg";
  const textColor = isInput ? "fg.muted" : "fg.subtle";

  return (
    <HStack gap={1} width="full" overflow="hidden" align="baseline">
      <Text textStyle="2xs" color="fg.subtle/30" flexShrink={0} lineHeight="1">
        {VERTICAL_BAR}
      </Text>
      <Flex align="center" gap={1} flexShrink={0}>
        <Icon boxSize="10px" color={accent}>
          {isInput ? <ArrowUp /> : <ArrowDown />}
        </Icon>
        <RoleIcon row={row} color={accent} direction={direction} />
      </Flex>
      <Text
        fontSize={fontSize}
        color={textColor}
        fontStyle="italic"
        fontWeight="400"
        truncate
        flex={1}
        minWidth={0}
      >
        {row.text}
      </Text>
    </HStack>
  );
};

const RoleIcon: React.FC<{
  row: { isChat: boolean; isTool: boolean };
  color: string;
  direction: "input" | "output";
}> = ({ row, color, direction }) => {
  if (direction === "input") {
    return row.isChat ? (
      <Icon boxSize="10px" color={color}>
        <User />
      </Icon>
    ) : null;
  }
  if (row.isTool) {
    return (
      <Icon boxSize="10px" color={color}>
        <Wrench />
      </Icon>
    );
  }
  if (row.isChat) {
    return (
      <Icon boxSize="10px" color={color}>
        <Bot />
      </Icon>
    );
  }
  return null;
};

const ComfortableIOPreview: React.FC<IOPreviewProps> = ({ input, output }) => (
  <VStack align="stretch" gap={2}>
    {input !== null && (
      <ComfortableRow
        label="Input"
        labelColor="blue.fg"
        textColor="fg.muted"
        text={formatPreview(input, { maxChars: 200 }).text}
      />
    )}
    {output !== null && (
      <ComfortableRow
        label="Output"
        labelColor="green.fg"
        textColor="fg"
        text={formatPreview(output, { maxChars: 200 }).text}
      />
    )}
  </VStack>
);

const ComfortableRow: React.FC<{
  label: string;
  labelColor: string;
  textColor: string;
  text: string;
}> = ({ label, labelColor, textColor, text }) => (
  <HStack align="baseline" gap={2}>
    <Text
      textStyle="sm"
      fontWeight="600"
      color={labelColor}
      flexShrink={0}
      width={COMFORTABLE_LABEL_WIDTH}
    >
      {label}
    </Text>
    <Text textStyle="sm" color={textColor} truncate flex={1} minWidth={0}>
      {text}
    </Text>
  </HStack>
);
