import { PropertySectionTitle } from "../../../../optimization_studio/components/properties/BasePropertiesPanel";

/**
 * MessageRoleLabel
 * Single Responsibility: Render a standardized label for a message role.
 */
export function MessageRoleLabel(props: {
  role: "system" | "user" | "assistant";
}) {
  const { role } = props;
  const label =
    role === "system"
      ? "System prompt"
      : role === "user"
      ? "user"
      : "assistant";
  return <PropertySectionTitle padding={0}>{label}</PropertySectionTitle>;
}
