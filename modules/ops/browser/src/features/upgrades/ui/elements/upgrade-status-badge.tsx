import { Badge } from "@langwatch/design-system/primitives";

import { tonePalette, type UpgradeLabel } from "../../model/upgrade-labels.ts";

/** One labelled state, step status or run outcome, in its tone. */
export function UpgradeStatusBadge({
  label,
  size = "sm",
}: {
  label: UpgradeLabel;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <Badge colorPalette={tonePalette(label.tone)} size={size} variant="subtle">
      {label.label}
    </Badge>
  );
}
