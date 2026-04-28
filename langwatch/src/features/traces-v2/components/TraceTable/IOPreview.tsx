import { Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, Bot, User, Wrench } from "lucide-react";
import type React from "react";
import { useDensityTokens } from "../../hooks/useDensityTokens";
import { useDensityStore } from "../../stores/densityStore";
import { type ParsedIO, tryParseChat } from "./chatContent";

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

const CompactIOPreview: React.FC<IOPreviewProps> = ({ input, output }) => {
  const tokens = useDensityTokens();
  return (
    <VStack align="start" gap={0.5} fontFamily="mono">
      {input !== null && (
        <CompactRow
          parsed={tryParseChat(input)}
          fontSize={tokens.ioFontSize}
          direction="input"
        />
      )}
      {output !== null && (
        <CompactRow
          parsed={tryParseChat(output)}
          fontSize={tokens.ioFontSize}
          direction="output"
        />
      )}
    </VStack>
  );
};

interface CompactRowProps {
  parsed: ParsedIO;
  fontSize: string;
  direction: "input" | "output";
}

const CompactRow: React.FC<CompactRowProps> = ({
  parsed,
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
        <RoleIcon parsed={parsed} color={accent} direction={direction} />
      </Flex>
      <Text
        fontSize={fontSize}
        color={textColor}
        fontStyle="italic"
        fontWeight="400"
        truncate
      >
        {parsed.text}
      </Text>
    </HStack>
  );
};

const RoleIcon: React.FC<{
  parsed: ParsedIO;
  color: string;
  direction: "input" | "output";
}> = ({ parsed, color, direction }) => {
  if (direction === "input") {
    return parsed.isChat ? (
      <Icon boxSize="10px" color={color}>
        <User />
      </Icon>
    ) : null;
  }
  if (parsed.isTool) {
    return (
      <Icon boxSize="10px" color={color}>
        <Wrench />
      </Icon>
    );
  }
  if (parsed.isChat) {
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
        text={tryParseChat(input).text}
      />
    )}
    {output !== null && (
      <ComfortableRow
        label="Output"
        labelColor="green.fg"
        textColor="fg"
        text={tryParseChat(output).text}
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
