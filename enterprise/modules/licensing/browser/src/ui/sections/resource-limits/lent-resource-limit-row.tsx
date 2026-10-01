import type { UiResourceLimitRowProps } from "@langwatch/browser-host/declarations";
import { LIMIT_TYPE_DISPLAY_LABELS } from "@langwatch/enterprise-licensing-contract";

import { ResourceLimitRow } from "./resource-limit-row.tsx";

/** The row as licensing lends it: licensing labels a limit type, the caller labels the rest. */
export function LentResourceLimitRow({ current, max, ...named }: UiResourceLimitRowProps) {
  const label = named.label ?? LIMIT_TYPE_DISPLAY_LABELS[named.limitType];
  return <ResourceLimitRow label={label} current={current} max={max} />;
}
