import {
  Box,
  Button,
  HStack,
  Icon,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuBot,
  LuCheck,
  LuChevronRight,
  LuCode,
  LuCopy,
  LuMessageCircle,
  LuType,
  LuUser,
  LuWrench,
} from "react-icons/lu";
import { Popover } from "~/components/ui/popover";
import { Tooltip } from "~/components/ui/tooltip";
import {
  type AttributeFormat,
  buildInlineDescriptor,
  type ChatMessage,
  KNOWN_CHAT_ROLES,
  normaliseChat,
  safeDetectFormat,
  stringifyForCopy,
  tryParseJson,
} from "./attributeFormat";
import { safePrettyJson } from "./JsonHighlight";

const EM_DASH = "—";
const COPY_FEEDBACK_MS = 1200;
const MAX_CHAT_MESSAGES_RENDERED = 100;

interface AttributeValueProps {
  attrKey: string;
  value: unknown;
}

export function AttributeValue({ attrKey, value }: AttributeValueProps) {
  const detected = useMemo(() => safeDetectFormat(value), [value]);
  const [override, setOverride] = useState<AttributeFormat | null>(null);
  // Reset per-row override when row identity changes.
  useEffect(() => setOverride(null), [attrKey, value]);
  const active = override ?? detected;

  const raw = useMemo(() => stringifyForCopy(value), [value]);
  const inline = useMemo(
    () => buildInlineDescriptor(value, detected, raw),
    [value, detected, raw],
  );

  if (detected === "leaf") {
    return (
      <Text
        flex={1}
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        truncate
        minWidth={0}
        paddingX={3}
        paddingY={1.5}
      >
        {inline.text || EM_DASH}
      </Text>
    );
  }

  return (
    // The trigger is the whole row — left-aligned preview + format
    // glyph + size hint + chevron. Hovering tints the row so the
    // affordance reads as a clickable card rather than as a button
    // glued to a sibling pill (the previous design's "[CHAT pill] +
    // [button]" layout had two visually distinct halves and didn't
    // make it obvious you could click anywhere on the row to expand).
    <Popover.Root
      positioning={{ placement: "right-start" }}
      lazyMount
      unmountOnExit
    >
      <Popover.Trigger asChild>
        <Box
          as="button"
          type="button"
          display="flex"
          alignItems="center"
          gap={2}
          flex={1}
          minWidth={0}
          paddingX={2}
          paddingY={1}
          borderRadius="sm"
          cursor="pointer"
          textAlign="left"
          color="fg"
          bg="transparent"
          transition="background 100ms ease, color 100ms ease"
          _hover={{ bg: "bg.muted", color: "fg" }}
          _focusVisible={{
            outline: "2px solid",
            outlineColor: "blue.focusRing",
            outlineOffset: "1px",
          }}
        >
          <FormatGlyph format={detected} />
          <Text textStyle="xs" fontFamily="mono" truncate minWidth={0} flex={1}>
            {inline.text}
          </Text>
          {inline.hint && (
            <Text
              textStyle="2xs"
              color="fg.subtle"
              fontFamily="mono"
              flexShrink={0}
            >
              {inline.hint}
            </Text>
          )}
          <Icon
            as={LuChevronRight}
            boxSize={3}
            color="fg.subtle"
            flexShrink={0}
          />
        </Box>
      </Popover.Trigger>
      <Popover.Content maxWidth="560px" minWidth="360px">
        <Popover.Arrow />
        <Popover.Body padding={0}>
          <VStack align="stretch" gap={0}>
            <HStack
              justify="space-between"
              align="center"
              gap={2}
              paddingX={3}
              paddingY={2}
              borderBottomWidth="1px"
              borderBottomColor="border.subtle"
            >
              <HStack gap={2} minWidth={0} flex={1}>
                <FormatGlyph format={detected} />
                <Text
                  textStyle="2xs"
                  color="fg.muted"
                  fontFamily="mono"
                  truncate
                  minWidth={0}
                >
                  {attrKey}
                </Text>
              </HStack>
              <CopyButton payload={raw} />
            </HStack>
            <Box paddingX={3} paddingY={2}>
              <FormatToggle active={active} onChange={setOverride} />
            </Box>
            <Box
              bg="bg.subtle"
              borderTopWidth="1px"
              borderTopColor="border.subtle"
              paddingX={3}
              paddingY={2}
              maxHeight="360px"
              overflow="auto"
            >
              <FormatBody value={value} format={active} raw={raw} />
            </Box>
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

const FORMAT_VISUALS: Record<
  Exclude<AttributeFormat, "leaf">,
  { label: string; icon: typeof LuCode; tone: string }
> = {
  chat: { label: "chat", icon: LuMessageCircle, tone: "purple" },
  json: { label: "json", icon: LuCode, tone: "blue" },
  "json-string": { label: "json", icon: LuCode, tone: "blue" },
  text: { label: "text", icon: LuType, tone: "gray" },
};

/**
 * Format indicator — small tinted icon at the leading edge of the
 * trigger / popover header. Replaces the previous "PILL with text"
 * treatment which doubled up on the format toggle inside the popover
 * and ate horizontal room in narrow drawer columns. The icon alone
 * is enough to telegraph chat / json / text at a glance; the toggle
 * still spells the word out for users who'd rather read it.
 */
function FormatGlyph({ format }: { format: Exclude<AttributeFormat, "leaf"> }) {
  const v = FORMAT_VISUALS[format];
  return (
    <Tooltip
      content={`Detected format: ${v.label}`}
      positioning={{ placement: "top" }}
    >
      <Box
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        width="18px"
        height="18px"
        borderRadius="sm"
        bg={`${v.tone}.subtle`}
        color={`${v.tone}.fg`}
        flexShrink={0}
        aria-label={`Detected format: ${v.label}`}
      >
        <Icon as={v.icon} boxSize={3} />
      </Box>
    </Tooltip>
  );
}

const OVERRIDE_OPTIONS: ReadonlyArray<{
  format: AttributeFormat;
  label: string;
}> = [
  { format: "chat", label: "Chat" },
  { format: "json", label: "JSON" },
  { format: "text", label: "Text" },
];

function FormatToggle({
  active,
  onChange,
}: {
  active: AttributeFormat;
  onChange: (next: AttributeFormat | null) => void;
}) {
  return (
    <HStack gap={1} flexShrink={0}>
      <Text
        textStyle="2xs"
        color="fg.muted"
        letterSpacing="0.06em"
        textTransform="uppercase"
        fontWeight="600"
      >
        Format
      </Text>
      {OVERRIDE_OPTIONS.map((opt) => {
        const selected =
          active === opt.format ||
          (opt.format === "json" && active === "json-string");
        return (
          <Button
            key={opt.format}
            size="2xs"
            variant={selected ? "solid" : "ghost"}
            colorPalette={selected ? "blue" : undefined}
            onClick={() => onChange(opt.format)}
            paddingX={2}
            fontWeight="medium"
          >
            {opt.label}
          </Button>
        );
      })}
    </HStack>
  );
}

function FormatBody({
  value,
  format,
  raw,
}: {
  value: unknown;
  format: AttributeFormat;
  raw: string;
}) {
  if (format === "chat") {
    const parsed = typeof value === "string" ? tryParseJson(value) : value;
    if (Array.isArray(parsed)) {
      return <ChatBody messages={normaliseChat(parsed)} />;
    }
    return <JsonBody raw={raw} />;
  }

  if (format === "json" || format === "json-string") {
    return <JsonBody raw={raw} />;
  }

  const text = typeof value === "string" ? value : raw;
  return (
    <Text
      textStyle="xs"
      fontFamily="mono"
      color="fg"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
    >
      {text}
    </Text>
  );
}

function JsonBody({ raw }: { raw: string }) {
  // Wrap in try/catch so a prettifier crash on adversarial input
  // doesn't tear down the row.
  const formatted = useMemo(() => {
    try {
      return safePrettyJson(raw);
    } catch {
      return raw;
    }
  }, [raw]);
  return (
    <Text
      as="pre"
      textStyle="xs"
      fontFamily="mono"
      color="fg"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      margin={0}
    >
      {formatted}
    </Text>
  );
}

function ChatBody({ messages }: { messages: ChatMessage[] }) {
  const visible = messages.slice(0, MAX_CHAT_MESSAGES_RENDERED);
  const hidden = messages.length - visible.length;
  return (
    <VStack align="stretch" gap={2}>
      {visible.map((m, i) => (
        <ChatRow key={i} message={m} />
      ))}
      {hidden > 0 && (
        <Text textStyle="2xs" color="fg.subtle" fontStyle="italic">
          + {hidden} more message{hidden === 1 ? "" : "s"} not shown
        </Text>
      )}
    </VStack>
  );
}

function ChatRow({ message }: { message: ChatMessage }) {
  const role = message.role.toLowerCase();
  const known = KNOWN_CHAT_ROLES.has(role);
  const RoleIcon =
    role === "assistant"
      ? LuBot
      : role === "tool" || role === "function"
        ? LuWrench
        : LuUser;
  return (
    <Box>
      <HStack gap={1.5} marginBottom={1}>
        <Icon
          as={RoleIcon}
          boxSize={3}
          color={known ? "fg.muted" : "fg.subtle"}
        />
        <Text
          textStyle="2xs"
          fontWeight="700"
          color={known ? "fg" : "fg.muted"}
          textTransform="uppercase"
          letterSpacing="0.08em"
        >
          {message.role}
        </Text>
      </HStack>
      <Text
        textStyle="xs"
        color="fg"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        paddingLeft={4}
      >
        {message.content || EM_DASH}
      </Text>
    </Box>
  );
}

function CopyButton({ payload }: { payload: string }) {
  const [copied, setCopied] = useState(false);
  const handleClick = useCallback(() => {
    void navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }, [payload]);
  return (
    <IconButton
      aria-label="Copy value"
      size="2xs"
      variant="ghost"
      onClick={handleClick}
    >
      <Icon
        as={copied ? LuCheck : LuCopy}
        boxSize={3}
        color={copied ? "green.fg" : "fg.subtle"}
      />
    </IconButton>
  );
}
