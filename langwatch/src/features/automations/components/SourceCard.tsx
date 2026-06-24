import { Box, Text } from "@chakra-ui/react";

export function SourceCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Box
      as="button"
      flex="1"
      textAlign="left"
      padding={3}
      borderRadius="md"
      colorPalette="orange"
      border="1px solid"
      borderColor={active ? "colorPalette.emphasized" : "border"}
      bg={active ? "colorPalette.subtle" : "bg"}
      onClick={onClick}
    >
      <Text fontWeight="semibold">{title}</Text>
      <Text textStyle="xs" color="fg.muted" mt={1}>
        {description}
      </Text>
    </Box>
  );
}
