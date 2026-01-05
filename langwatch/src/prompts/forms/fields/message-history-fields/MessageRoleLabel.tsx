import {
  PropertySectionTitle,
  type PropertySectionTitleProps,
} from "~/components/ui/PropertySectionTitle";
import { Text } from "@chakra-ui/react";

export type MessageRoleLabelProps = Omit<
  PropertySectionTitleProps,
  "children"
> & {
  role: "system" | "user" | "assistant";
};

/**
 * MessageRoleLabel
 * Single Responsibility: Render a standardized label for a message role.
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
