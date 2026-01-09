import { Badge, Box, HStack, Input, Text, useDisclosure } from "@chakra-ui/react";
import { useCallback, useMemo } from "react";
import type { Field as DSLField } from "~/optimization_studio/types/dsl";
import { VariableTypeIcon } from "~/prompts/components/ui/VariableTypeIcon";
import { JsonEditorModal } from "./JsonEditorModal";
import { MessagesEditorModal } from "./MessagesEditorModal";

export type InputValueRowProps = {
  input: DSLField;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * A single input row with key = value design.
 * Clicking on the value opens the appropriate editor based on type.
 */
export function InputValueRow({
  input,
  value,
  onChange,
  disabled = false,
}: InputValueRowProps) {
  const jsonModal = useDisclosure();
  const messagesModal = useDisclosure();

  const { isExpandable, displayValue, badgeLabel, badgeColor } = useMemo(() => {
    return getValueDisplay(input.type, value);
  }, [input.type, value]);

  const handleClick = useCallback(() => {
    if (disabled || !isExpandable) return;

    if (input.type === "chat_messages") {
      messagesModal.onOpen();
    } else if (isJsonType(input.type)) {
      jsonModal.onOpen();
    }
  }, [disabled, isExpandable, input.type, jsonModal, messagesModal]);

  const handleJsonSave = useCallback(
    (newValue: string) => {
      onChange(newValue);
      jsonModal.onClose();
    },
    [onChange, jsonModal]
  );

  const handleMessagesSave = useCallback(
    (messages: Array<{ role: string; content: string }>) => {
      onChange(JSON.stringify(messages));
      messagesModal.onClose();
    },
    [onChange, messagesModal]
  );

  // Parse messages for the modal
  const parsedMessages = useMemo(() => {
    if (input.type !== "chat_messages") return [];
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [input.type, value]);

  return (
    <>
      <HStack gap={2} width="full" align="center">
        {/* Type Icon */}
        <Box flexShrink={0}>
          <VariableTypeIcon type={input.type} size={14} />
        </Box>

        {/* Key name */}
        <Text fontFamily="mono" fontSize="13px" color="gray.600" flexShrink={0}>
          {input.identifier}
        </Text>

        {/* = sign */}
        <Text color="gray.400" fontSize="sm" flexShrink={0}>
          =
        </Text>

        {/* Value display */}
        {isExpandable ? (
          <Box
            onClick={handleClick}
            cursor={disabled ? "default" : "pointer"}
            flex={1}
            minWidth={0}
            _hover={disabled ? undefined : { opacity: 0.8 }}
          >
            {badgeLabel ? (
              <Badge
                colorPalette={badgeColor}
                variant="subtle"
                fontFamily="mono"
                fontSize="11px"
              >
                {badgeLabel}
              </Badge>
            ) : (
              <Text
                fontFamily="mono"
                fontSize="13px"
                color="gray.500"
                truncate
              >
                {displayValue}
              </Text>
            )}
          </Box>
        ) : (
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            size="sm"
            flex={1}
            minWidth={0}
            fontFamily="mono"
            fontSize="13px"
            variant="flushed"
            borderColor="gray.200"
            disabled={disabled}
          />
        )}
      </HStack>

      {/* JSON Editor Modal */}
      <JsonEditorModal
        open={jsonModal.open}
        onClose={jsonModal.onClose}
        value={value}
        onSave={handleJsonSave}
        title={`Edit ${input.identifier}`}
        fieldType={input.type}
      />

      {/* Messages Editor Modal */}
      <MessagesEditorModal
        open={messagesModal.open}
        onClose={messagesModal.onClose}
        messages={parsedMessages}
        onSave={handleMessagesSave}
        title={`Edit ${input.identifier}`}
      />
    </>
  );
}

function isJsonType(type: string): boolean {
  return ["dict", "list", "list[str]", "json"].includes(type);
}

type ValueDisplay = {
  isExpandable: boolean;
  displayValue: string;
  badgeLabel?: string;
  badgeColor?: string;
};

function getValueDisplay(type: string, value: string): ValueDisplay {
  switch (type) {
    case "chat_messages": {
      try {
        const messages = JSON.parse(value || "[]");
        const count = Array.isArray(messages) ? messages.length : 0;
        return {
          isExpandable: true,
          displayValue: "",
          badgeLabel: `${count} message${count !== 1 ? "s" : ""}`,
          badgeColor: "purple",
        };
      } catch {
        return {
          isExpandable: true,
          displayValue: "",
          badgeLabel: "0 messages",
          badgeColor: "purple",
        };
      }
    }
    case "dict":
    case "json":
      return {
        isExpandable: true,
        displayValue: "",
        badgeLabel: "{JSON}",
        badgeColor: "blue",
      };
    case "list":
    case "list[str]":
      return {
        isExpandable: true,
        displayValue: "",
        badgeLabel: "[List]",
        badgeColor: "teal",
      };
    case "image":
      return {
        isExpandable: false,
        displayValue: value,
        badgeLabel: "[IMG]",
        badgeColor: "orange",
      };
    default:
      // str, bool, float, int - editable inline
      return {
        isExpandable: false,
        displayValue: value,
      };
  }
}
