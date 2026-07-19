/**
 * Lovable-style tag pill component for displaying a single label.
 *
 * Renders a rounded pill with optional remove button.
 */

import { HStack, Text, chakra } from "@chakra-ui/react";
import { X } from "lucide-react";

const StyledButton = chakra("button");

type TagPillProps = {
  label: string;
  onRemove?: () => void;
};

export function TagPill({ label, onRemove }: TagPillProps) {
  return (
    <HStack
      gap={1}
      bg="bg.muted"
      px={2}
      py={0.5}
      borderRadius="full"
      fontSize="xs"
      data-testid={`tag-pill-${label}`}
    >
      <Text fontSize="xs">{label}</Text>
      {onRemove && (
        <StyledButton
          type="button"
          aria-label={`Remove ${label} tag`}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onRemove();
          }}
          display="flex"
          alignItems="center"
          cursor="pointer"
          color="fg.muted"
          _hover={{ color: "fg" }}
          background="transparent"
          border="none"
          padding={0}
        >
          <X size={12} />
        </StyledButton>
      )}
    </HStack>
  );
}
