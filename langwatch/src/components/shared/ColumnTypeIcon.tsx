/**
 * ColumnTypeIcon - Icon representing the type of a dataset column.
 *
 * Shared between Evaluations V3 and Batch Results tables.
 */
import { Braces, Hash, MessageSquare, ToggleLeft, Type } from "lucide-react";

export type ColumnType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "chat_messages"
  | string;

type ColumnTypeIconProps = {
  /** The type of the column */
  type: ColumnType;
  /** Size of the icon (default: 12) */
  size?: number;
};

/**
 * Returns an icon based on the column type.
 * - string: Text icon (blue)
 * - number: Hash icon (green)
 * - boolean: Toggle icon (teal)
 * - json: Braces icon (purple)
 * - chat_messages: Message icon (orange)
 * - default: Text icon (gray)
 */
export const ColumnTypeIcon = ({ type, size = 12 }: ColumnTypeIconProps) => {
  const iconProps = { size, strokeWidth: 2.5 };

  switch (type) {
    case "string":
      return <Type {...iconProps} color="var(--chakra-colors-blue-500)" />;
    case "number":
      return <Hash {...iconProps} color="var(--chakra-colors-green-500)" />;
    case "boolean":
      // ToggleLeft icon appears smaller visually, so bump size slightly
      return <ToggleLeft size={size + 2} strokeWidth={2.5} color="var(--chakra-colors-teal-500)" />;
    case "json":
      return <Braces {...iconProps} color="var(--chakra-colors-purple-500)" />;
    case "chat_messages":
      return (
        <MessageSquare {...iconProps} color="var(--chakra-colors-orange-500)" />
      );
    default:
      return <Type {...iconProps} color="var(--chakra-colors-gray-400)" />;
  }
};
