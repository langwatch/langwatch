import { Box } from "@chakra-ui/react";
import { Braces, Hash, Image, List, MessageSquare, ToggleLeft, Type } from "lucide-react";

export const VariableTypeIcon = ({
  type,
  size = 16,
}: {
  type: string;
  size?: number;
}) => {
  const iconProps = { size, strokeWidth: 2.5, color: "var(--chakra-colors-gray-500)" };
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

export const getTypeLabel = (type: string): string => TYPE_LABELS[type] ?? type;

export const VariableTypeBadge = ({
  type,
  size = "sm",
}: {
  type: string;
  size?: "xs" | "sm";
}) => (
  <Box
    as="span"
    fontSize={size === "xs" ? "10px" : "11px"}
    fontWeight="medium"
    color="fg.muted"
    bg="bg.muted"
    borderRadius="4px"
    padding={size === "xs" ? "2px 4px" : "2px 6px"}
    fontFamily="mono"
    whiteSpace="nowrap"
  >
    {getTypeLabel(type)}
  </Box>
);
