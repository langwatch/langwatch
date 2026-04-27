import { ArrowDown, ArrowUp, User, Bot, Wrench } from "lucide-react";
import { Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useDensityTokens } from "../../hooks/useDensityTokens";
import { useUIStore } from "../../stores/uiStore";

interface IOPreviewProps {
  input: string | null;
  output: string | null;
}

export const IOPreview: React.FC<IOPreviewProps> = ({ input, output }) => {
  const density = useUIStore((s) => s.density);
  if (density === "comfortable") {
    return <ComfortableIOPreview input={input} output={output} />;
  }
  return <CompactIOPreview input={input} output={output} />;
};

const CompactIOPreview: React.FC<IOPreviewProps> = ({ input, output }) => {
  const tokens = useDensityTokens();
  const parsedInput = tryParseChat(input);
  const parsedOutput = tryParseChat(output);
  return (
    <VStack align="start" gap={0.5} fontFamily="mono">
      {input !== null && (
        <HStack gap={1} width="full" overflow="hidden" align="baseline">
          <Text textStyle="2xs" color="fg.subtle/30" flexShrink={0} lineHeight="1">
            {"\u2506"}
          </Text>
          <Flex align="center" gap={1} flexShrink={0}>
            <Icon boxSize="10px" color="blue.fg">
              <ArrowUp />
            </Icon>
            {parsedInput.isChat && (
              <Icon boxSize="10px" color="blue.fg">
                <User />
              </Icon>
            )}
          </Flex>
          <Text fontSize={tokens.ioFontSize} color="fg.muted" fontStyle="italic" fontWeight="400" truncate>
            {parsedInput.text}
          </Text>
        </HStack>
      )}
      {output !== null && (
        <HStack gap={1} width="full" overflow="hidden" align="baseline">
          <Text textStyle="2xs" color="fg.subtle/30" flexShrink={0} lineHeight="1">
            {"\u2506"}
          </Text>
          <Flex align="center" gap={1} flexShrink={0}>
            <Icon boxSize="10px" color="green.fg">
              <ArrowDown />
            </Icon>
            {parsedOutput.isTool ? (
              <Icon boxSize="10px" color="green.fg">
                <Wrench />
              </Icon>
            ) : parsedOutput.isChat ? (
              <Icon boxSize="10px" color="green.fg">
                <Bot />
              </Icon>
            ) : null}
          </Flex>
          <Text fontSize={tokens.ioFontSize} color="fg.subtle" fontStyle="italic" fontWeight="400" truncate>
            {parsedOutput.text}
          </Text>
        </HStack>
      )}
    </VStack>
  );
};

const ComfortableIOPreview: React.FC<IOPreviewProps> = ({ input, output }) => {
  const parsedInput = tryParseChat(input);
  const parsedOutput = tryParseChat(output);
  return (
    <VStack align="stretch" gap={2}>
      {input !== null && (
        <HStack align="baseline" gap={2}>
          <Text
            textStyle="sm"
            fontWeight="600"
            color="blue.fg"
            flexShrink={0}
            width="60px"
          >
            Input
          </Text>
          <Text textStyle="sm" color="fg.muted" truncate flex={1} minWidth={0}>
            {parsedInput.text}
          </Text>
        </HStack>
      )}
      {output !== null && (
        <HStack align="baseline" gap={2}>
          <Text
            textStyle="sm"
            fontWeight="600"
            color="green.fg"
            flexShrink={0}
            width="60px"
          >
            Output
          </Text>
          <Text textStyle="sm" color="fg" truncate flex={1} minWidth={0}>
            {parsedOutput.text}
          </Text>
        </HStack>
      )}
    </VStack>
  );
};

interface ParsedIO {
  text: string;
  isChat: boolean;
  isTool: boolean;
}

const SNIPPET_LEN = 80;

function snippet(s: string): string {
  return s.length > SNIPPET_LEN ? s.slice(0, SNIPPET_LEN) + "\u2026" : s;
}

// Chat message `content` can be a string, null, or an array of content parts
// (e.g. OpenAI vision/parts: [{type: "text", text: "..."}, {type: "image_url", ...}]).
// Always coerce to a plain string before rendering.
function contentToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return JSON.stringify(content);
}

function tryParseChat(raw: string | null): ParsedIO {
  if (!raw) return { text: "", isChat: false, isTool: false };

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].role) {
      const last = parsed[parsed.length - 1];
      if (last.tool_calls) {
        const fn = last.tool_calls[0]?.function?.name ?? "tool";
        return { text: `${fn}(...)`, isChat: false, isTool: true };
      }
      return { text: snippet(contentToString(last.content)), isChat: true, isTool: false };
    }
    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      return { text: snippet(JSON.stringify(parsed)), isChat: false, isTool: false };
    }
  } catch {
    // not JSON
  }

  return { text: snippet(raw), isChat: false, isTool: false };
}
