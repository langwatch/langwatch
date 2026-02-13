import { Box } from "@chakra-ui/react";
import {
  Braces,
  Hash,
  Image,
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
  size = 16,
}: {
  type: string;
  size?: number;
}) => {
  const iconProps = {
    size,
    strokeWidth: 2.5,
    color: "var(--chakra-colors-gray-500)",
  };

  switch (type) {
    case "str":
    case "string":
      return <Type {...iconProps} />;

    case "float":
    case "int":
    case "number":
      return <Hash {...iconProps} />;

    case "bool":
    case "boolean":
      return <ToggleLeft {...iconProps} />;

    case "list":
    case "list[str]":
    case "list[float]":
    case "list[int]":
    case "list[bool]":
      return <List {...iconProps} />;

    case "dict":
    case "json":
    case "json_schema":
      return <Braces {...iconProps} />;

    case "chat_messages":
      return <MessageSquare {...iconProps} />;

    case "image":
      return <Image {...iconProps} />;

    default:
      return <Type {...iconProps} />;
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
      color="fg.muted"
      bg="bg.muted"
      borderRadius="4px"
      padding={padding}
      fontFamily="mono"
      whiteSpace="nowrap"
    >
      {label}
    </Box>
  );
};
