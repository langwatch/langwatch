import { Circle, Flex, Text } from "@chakra-ui/react";

export function FilterChip({
  label,
  count,
  isActive,
  isDisabled,
  onClick,
  color,
}: {
  label: string;
  count: number;
  isActive: boolean;
  isDisabled?: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <Flex
      as="button"
      align="center"
      gap={1}
      paddingX={2}
      paddingY={0.5}
      borderRadius="full"
      borderWidth="1px"
      borderColor={isActive ? (color ?? "border.emphasized") : "border.subtle"}
      bg={isActive ? "bg.emphasized" : "transparent"}
      cursor={isDisabled ? "default" : "pointer"}
      opacity={isDisabled ? 0.4 : 1}
      onClick={isDisabled ? undefined : onClick}
      _hover={
        isDisabled ? undefined : { bg: isActive ? "bg.emphasized" : "bg.muted" }
      }
      transition="all 0.15s ease"
    >
      {color && <Circle size="6px" bg={color} />}
      <Text
        textStyle="xs"
        color={isActive ? "fg" : "fg.muted"}
        fontWeight={isActive ? "medium" : "normal"}
        lineHeight={1}
      >
        {label}
      </Text>
      <Text textStyle="xs" color="fg.subtle" lineHeight={1}>
        {count}
      </Text>
    </Flex>
  );
}
