import { Text, type TextProps } from "@chakra-ui/react";

export type MessageRole = "system" | "user" | "assistant";

export type MessageRoleLabelProps = Omit<TextProps, "children"> & {
  role: MessageRole;
};

/**
 * Standardized label for a message role.
 * Used in prompt playground and HTTP agent test panel.
 */
export function MessageRoleLabel({ role, ...props }: MessageRoleLabelProps) {
  const label =
    role === "system"
      ? "System prompt"
      : role === "user"
        ? "User"
        : "Assistant";

  return (
    <Text
      fontSize="xs"
      textTransform="none"
      fontWeight="normal"
      color="gray.500"
      backgroundColor="gray.100"
      paddingX={2}
      paddingY={0.5}
      borderRadius="lg"
      display="inline-block"
      {...props}
    >
      {label}
    </Text>
  );
}
