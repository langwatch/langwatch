import { Badge } from "@langwatch/design-system/primitives";

/** Marks a control the plan does not carry. Never a refusal: what is in force stays in force. */
export function EnterprisePlanBadge({
  size = "sm",
  "data-testid": testId,
}: {
  size?: "xs" | "sm";
  "data-testid"?: string;
}) {
  return (
    <Badge colorPalette="orange" size={size} variant="surface" data-testid={testId}>
      Enterprise plan
    </Badge>
  );
}
