import { Box, IconButton } from "@chakra-ui/react";
import { LuTrash2 } from "react-icons/lu";
import { useState } from "react";

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
export function DeletableMessage({ messageId, onDelete, children }: DeletableMessageProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Box
      position="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
      {isHovered && (
        <IconButton
          aria-label="Delete message"
          size="xs"
          variant="ghost"
          colorScheme="red"
          position="absolute"
          top={2}
          right={2}
          onClick={() => onDelete(messageId)}
          zIndex={1}
        >
          <LuTrash2 size={14} />
        </IconButton>
      )}
    </Box>
  );
}
