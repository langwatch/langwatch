import {
  PropertySectionTitle,
  type PropertySectionTitleProps,
} from "~/components/ui/PropertySectionTitle";

export type MessageRoleLabelProps = Omit<PropertySectionTitleProps, "children"> & {
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
        ? "user"
        : "assistant";
  return (
    <PropertySectionTitle padding={0} {...props}>
      {label}
    </PropertySectionTitle>
  );
}
