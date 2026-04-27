import { useState, useMemo } from "react";
import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import {
  LuCheck,
  LuCode,
  LuCopy,
  LuBot,
  LuSettings,
  LuUser,
  LuWrench,
} from "react-icons/lu";
import type { IconType } from "react-icons";
import { SegmentedToggle } from "./SegmentedToggle";
import { JsonView } from "./JsonHighlight";

interface IOViewerProps {
  label: string;
  content: string;
}

type ViewFormat = "pretty" | "text" | "json";

interface ChatMessage {
  role: string;
  content: string | null | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{
    function: { name: string; arguments: string };
    id: string;
    type: string;
  }>;
}

function tryParseJSON(s: string): unknown | null {
  try {
    const trimmed = s.trim();
    if (
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      (trimmed.endsWith("}") || trimmed.endsWith("]"))
    ) {
      return JSON.parse(trimmed);
    }
    return null;
  } catch {
    return null;
  }
}

function isChatMessagesArray(data: unknown): data is ChatMessage[] {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return false;
  return data.every((item: unknown) => {
    if (typeof item !== "object" || item === null) return false;
    const obj = item as Record<string, unknown>;
    return typeof obj.role === "string";
  });
}

function getMessageContent(
  content: string | null | Array<{ type: string; text?: string }>,
): string {
  if (content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
  }
  return String(content);
}

const ROLE_LABELS: Record<string, string> = {
  system: "SYSTEM",
  user: "USER",
  assistant: "ASSISTANT",
  tool: "TOOL",
  developer: "DEVELOPER",
};

const ROLE_COLORS: Record<string, string> = {
  system: "fg.muted",
  user: "blue.fg",
  assistant: "green.fg",
  tool: "orange.fg",
  developer: "purple.fg",
};

const ROLE_ICONS: Record<string, IconType> = {
  system: LuSettings,
  user: LuUser,
  assistant: LuBot,
  tool: LuWrench,
  developer: LuCode,
};

function ChatMessageView({ message }: { message: ChatMessage }) {
  const label = ROLE_LABELS[message.role] ?? message.role.toUpperCase();
  const color = ROLE_COLORS[message.role] ?? "fg.muted";
  const RoleIcon = ROLE_ICONS[message.role];
  const content = getMessageContent(message.content);

  return (
    <Box marginBottom={2}>
      <HStack gap={1} marginBottom={0.5}>
        {RoleIcon && <Icon as={RoleIcon} boxSize={3} color={color} />}
        <Text
          textStyle="xs"
          fontWeight="semibold"
          color={color}
          letterSpacing="wide"
        >
          {label}
        </Text>
      </HStack>
      {message.tool_calls && message.tool_calls.length > 0 ? (
        <VStack align="stretch" gap={1} marginLeft={4}>
          {message.tool_calls.map((tc, i) => (
            <Box
              key={i}
              paddingLeft={2}
              borderLeftWidth="2px"
              borderColor="orange.muted"
            >
              <Text textStyle="xs" fontWeight="semibold" color="orange.fg">
                TOOL CALL: {tc.function.name}
              </Text>
              <Box
                bg="bg.subtle"
                borderRadius="sm"
                padding={2}
                marginTop={1}
                textStyle="xs"
                fontFamily="mono"
                color="fg.muted"
                whiteSpace="pre-wrap"
                wordBreak="break-all"
              >
                {tc.function.arguments}
              </Box>
            </Box>
          ))}
        </VStack>
      ) : content ? (
        <Text
          textStyle="xs"
          color="fg"
          marginLeft={4}
          lineHeight="tall"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
        >
          {content}
        </Text>
      ) : (
        <Text
          textStyle="xs"
          color="fg.subtle"
          fontStyle="italic"
          marginLeft={4}
        >
          No content
        </Text>
      )}
    </Box>
  );
}


function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={handleCopy}
      aria-label="Copy to clipboard"
      padding={0}
      minWidth="auto"
      height="auto"
    >
      <Icon
        as={copied ? LuCheck : LuCopy}
        boxSize={3}
        color={copied ? "green.fg" : "fg.subtle"}
      />
    </Button>
  );
}

export function IOViewer({ label, content }: IOViewerProps) {
  const parsed = useMemo(() => tryParseJSON(content), [content]);
  const isChat = useMemo(() => isChatMessagesArray(parsed), [parsed]);
  const canJson = parsed !== null;

  const [format, setFormat] = useState<ViewFormat>("pretty");
  const [expanded, setExpanded] = useState(false);

  const isLong = content.length > 5000;
  const displayContent =
    !isLong || expanded ? content : content.slice(0, 5000) + "...";

  return (
    <Box>
      <HStack marginBottom={1} gap={2}>
        <Text
          textStyle="xs"
          fontWeight="semibold"
          color="fg.muted"
          letterSpacing="wide"
          textTransform="uppercase"
        >
          {label}
        </Text>
        <Box flex={1} />
        {canJson && (
          <SegmentedToggle
            value={format}
            onChange={(f) => setFormat(f as ViewFormat)}
            options={["pretty", "text", "json"]}
          />
        )}
        <CopyButton text={content} />
      </HStack>

      <Box
        bg="bg.subtle"
        borderRadius="md"
        borderWidth="1px"
        borderColor="border"
        padding={3}
        maxHeight={isLong && !expanded ? "300px" : "500px"}
        overflow="auto"
      >
        {format === "json" && canJson ? (
          <JsonView content={displayContent} />
        ) : format === "pretty" && isChat ? (
          <Box>
            {(parsed as ChatMessage[]).map((msg, i) => (
              <ChatMessageView key={i} message={msg} />
            ))}
          </Box>
        ) : format === "pretty" && canJson ? (
          <JsonView content={displayContent} />
        ) : (
          <Text
            textStyle="xs"
            color="fg"
            fontFamily="mono"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            lineHeight="tall"
          >
            {displayContent}
          </Text>
        )}
      </Box>

      {isLong && (
        <Button
          size="xs"
          variant="plain"
          color="blue.fg"
          padding={0}
          height="auto"
          marginTop={1}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded
            ? "Show less"
            : `Show full output (${(content.length / 1000).toFixed(1)}K chars)`}
        </Button>
      )}
    </Box>
  );
}
