/**
 * Binds the `/api/analytics` REST declarations to this process's own root.
 * Canonical and legacy are separate apps, not an alias pair — their refusal
 * bodies differ.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { analyticsRest, analyticsLegacyRest } from "@langwatch/analytics-server";
import type { MountableRestApp } from "@langwatch/api/rest";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/analytics/*` and its `/api/analytics` legacy sibling. */
export function mountAnalyticsRest(
  runtime: ApiRestRuntime,
  options: Readonly<{ analytics: () => AnalyticsApi }>,
): MountableRestApp[] {
  return [
    runtime.mount(analyticsRest.router(), options.analytics),
    runtime.mount(analyticsLegacyRest.router(), options.analytics),
  ];
}
