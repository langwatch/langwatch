import { Box, Heading, HStack, IconButton, Spacer } from "@chakra-ui/react";
import { LuX } from "react-icons/lu";

type ConfigPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
};

/**
 * Glossy configuration panel that slides in from the right.
 *
 * Features:
 * - Frosted glass background effect (macOS style)
 * - Slides in from right edge
 * - No backdrop - table remains fully interactive
 * - Positioned within the table container boundaries
 */
export function ConfigPanel({
  isOpen,
  onClose,
  title,
  children,
  width = "400px",
}: ConfigPanelProps) {
  return (
    <Box
      position="absolute"
      right={0}
      top={0}
      bottom={0}
      width={width}
      bg="bg.panel/85"
      backdropFilter="blur(8px)"
      transform={isOpen ? "translateX(0)" : "translateX(100%)"}
      transition="transform 0.25s ease-out"
      zIndex={50}
      display="flex"
      flexDirection="column"
      overflow="hidden"
      borderLeft="1px solid"
      borderColor="border.muted"
    >
      {/* Header */}
      <HStack
        paddingX={4}
        paddingY={2}
        borderBottom="1px solid"
        borderColor="border.muted"
        flexShrink={0}
      >
        <Heading size="sm" fontWeight="semibold">
          {title}
        </Heading>
        <Spacer />
        <IconButton
          aria-label="Close"
          variant="ghost"
          size="sm"
          onClick={onClose}
        >
          <LuX size={18} />
        </IconButton>
      </HStack>

      {/* Content */}
      <Box flex={1} overflowY="auto" padding={4}>
        {children}
      </Box>
    </Box>
  );
}
