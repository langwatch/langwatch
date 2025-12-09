import { HStack, IconButton } from "@chakra-ui/react";
import { useState } from "react";
import { LuTrash2 } from "react-icons/lu";

interface DeletableMessageProps {
  messageId: string;
  onDelete: (messageId: string) => void;
  children: React.ReactNode;
}

/**
 * DeletableMessage
 * Single Responsibility: Wraps message components with delete functionality.
 * Shows delete button on hover for clean UI.
 */
export function DeletableMessage({
  messageId,
  onDelete,
  children,
}: DeletableMessageProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <HStack
      position="relative"
      gap={2}
      align="center"
      justify="start"
      width="full"
      justifyContent="space-between"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
      <IconButton
        visibility={isHovered ? "visible" : "hidden"}
        aria-label="Delete message"
        size="xs"
        variant="ghost"
        colorPalette="red"
        onClick={() => onDelete(messageId)}
      >
        <LuTrash2 size={14} color="currentColor" />
      </IconButton>
    </HStack>
  );
}
