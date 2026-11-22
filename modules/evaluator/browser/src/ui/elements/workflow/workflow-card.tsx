import { Link } from "@langwatch/browser-host/link";
import { WORKFLOW_CARD_OPENER_STYLE } from "@langwatch/design-system/workflow-card";

/** A card opener that navigates rather than acts. */
export function WorkflowCardLink({
  label,
  ...props
}: { label: string } & Omit<React.ComponentProps<typeof Link>, "children">) {
  return <Link aria-label={label} {...WORKFLOW_CARD_OPENER_STYLE} {...props} />;
}
