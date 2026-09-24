import { Text, type TextProps } from "@chakra-ui/react";

export type MessageRole = "system" | "user" | "assistant";

export type MessageRoleLabelProps = Omit<TextProps, "children"> & {
  role: MessageRole;
};

function roleLabel(role: MessageRole): string {
  if (role === "system") return "System prompt";
  if (role === "user") return "User";
  return "Assistant";
}

/**
 * Standardized label for a message role.
 * Used in prompt playground and HTTP agent test panel.
 */
export function MessageRoleLabel({ role, ...props }: MessageRoleLabelProps) {
  const label = roleLabel(role);

  return (
    <Text
      fontSize="xs"
      textTransform="none"
      fontWeight="normal"
      color="fg.muted"
      backgroundColor="bg.muted"
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
