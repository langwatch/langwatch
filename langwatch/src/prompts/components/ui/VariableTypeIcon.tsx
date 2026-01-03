import { Box } from "@chakra-ui/react";
import {
  Braces,
  Hash,
  List,
  MessageSquare,
  ToggleLeft,
  Type,
} from "lucide-react";

/**
 * Maps variable types (from DSL Field types) to visual icons.
 *
 * Used in the Variables section to give users a quick visual indicator
 * of what type each variable is.
 */
export const VariableTypeIcon = ({
  type,
  size = 14,
}: {
  type: string;
  size?: number;
}) => {
  const iconProps = { size, strokeWidth: 2.5 };

  switch (type) {
    case "str":
    case "string":
      return <Type {...iconProps} color="var(--chakra-colors-blue-500)" />;

    case "float":
    case "int":
    case "number":
      return <Hash {...iconProps} color="var(--chakra-colors-green-500)" />;

    case "bool":
    case "boolean":
      return <ToggleLeft {...iconProps} color="var(--chakra-colors-orange-500)" />;

    case "list":
    case "list[str]":
    case "list[float]":
    case "list[int]":
    case "list[bool]":
      return <List {...iconProps} color="var(--chakra-colors-purple-500)" />;

    case "dict":
    case "json":
    case "json_schema":
      return <Braces {...iconProps} color="var(--chakra-colors-cyan-500)" />;

    case "chat_messages":
      return (
        <MessageSquare {...iconProps} color="var(--chakra-colors-pink-500)" />
      );

    default:
      return <Type {...iconProps} color="var(--chakra-colors-gray-400)" />;
  }
};

/**
 * Human-readable type labels.
 * Used consistently across VariablesSection type selector and VariableInsertMenu badges.
 */
export const TYPE_LABELS: Record<string, string> = {
  str: "Text",
  string: "Text",
  float: "Number",
  int: "Number",
  number: "Number",
  bool: "Boolean",
  boolean: "Boolean",
  image: "Image",
  list: "List",
  "list[str]": "List",
  "list[float]": "List",
  "list[int]": "List",
  "list[bool]": "List",
  dict: "Object",
  json: "Object",
  json_schema: "JSON Schema",
  chat_messages: "Messages",
};

/**
 * Get the display label for a variable type.
 * Used in type badges and dropdowns.
 */
export const getTypeLabel = (type: string): string => {
  return TYPE_LABELS[type] ?? type;
};

/**
 * Type badge component showing the type label with appropriate styling.
 */
export const VariableTypeBadge = ({
  type,
  size = "sm",
}: {
  type: string;
  size?: "xs" | "sm";
}) => {
  const label = getTypeLabel(type);
  const fontSize = size === "xs" ? "10px" : "11px";
  const padding = size === "xs" ? "2px 4px" : "2px 6px";

  return (
    <Box
      as="span"
      fontSize={fontSize}
      fontWeight="medium"
      color="gray.600"
      bg="gray.100"
      borderRadius="4px"
      padding={padding}
      fontFamily="mono"
      whiteSpace="nowrap"
    >
      {label}
    </Box>
  );
};
