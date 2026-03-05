/**
 * ColumnTypeIcon - Icon representing the type of a dataset column.
 *
 * Shared between Evaluations V3 and Batch Results tables.
 */
import {
  BookOpen,
  Braces,
  Calendar,
  ClipboardCheck,
  Hash,
  ImageIcon,
  Layers,
  List,
  MessageSquare,
  PenLine,
  ToggleLeft,
  Type,
} from "lucide-react";

export type ColumnType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "chat_messages"
  | "image"
  | "date"
  | "list"
  | "rag_contexts"
  | "spans"
  | "annotations"
  | "evaluations"
  | string;

type ColumnTypeIconProps = {
  /** The type of the column */
  type: ColumnType;
  /** Size of the icon (default: 12) */
  size?: number;
};

export const ColumnTypeIcon = ({ type, size = 12 }: ColumnTypeIconProps) => {
  const iconProps = { size, strokeWidth: 2.5 };

  switch (type) {
    case "string":
      return <Type {...iconProps} color="var(--chakra-colors-blue-500)" />;
    case "number":
      return <Hash {...iconProps} color="var(--chakra-colors-green-500)" />;
    case "boolean":
      return <ToggleLeft size={size + 2} strokeWidth={2.5} color="var(--chakra-colors-teal-500)" />;
    case "json":
      return <Braces {...iconProps} color="var(--chakra-colors-purple-500)" />;
    case "chat_messages":
      return <MessageSquare {...iconProps} color="var(--chakra-colors-orange-500)" />;
    case "image":
      return <ImageIcon {...iconProps} color="var(--chakra-colors-gray-400)" />;
    case "date":
      return <Calendar {...iconProps} color="var(--chakra-colors-yellow-600)" />;
    case "list":
      return <List {...iconProps} color="var(--chakra-colors-purple-400)" />;
    case "rag_contexts":
      return <BookOpen {...iconProps} color="var(--chakra-colors-cyan-500)" />;
    case "spans":
      return <Layers {...iconProps} color="var(--chakra-colors-gray-500)" />;
    case "annotations":
      return <PenLine {...iconProps} color="var(--chakra-colors-yellow-500)" />;
    case "evaluations":
      return <ClipboardCheck {...iconProps} color="var(--chakra-colors-green-600)" />;
    default:
      return <Type {...iconProps} color="var(--chakra-colors-gray-400)" />;
  }
};
