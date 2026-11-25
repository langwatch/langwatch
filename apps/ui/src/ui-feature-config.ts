import type { RequiredUiConfig } from "@langwatch/browser";
import type { UiDeployment } from "@langwatch/browser-host/capabilities";
import { deriveUiDeployment } from "@langwatch/browser-host/deployment";
import type { UiPublicTelemetry } from "@langwatch/browser/inner-providers";
import type { ProcessWebConfig } from "@langwatch/config/public-app-config";

import type { browserModules } from "./browser-modules.generated.ts";

/** What each installed web module projected from the slices it claims, by module name. */
export type InstalledUiConfig = RequiredUiConfig<typeof browserModules>;

/** The process owner's slice, then every installed module's projection. */
export type UiFeatureConfig = Readonly<{ process: ProcessWebConfig }> & InstalledUiConfig;

export function uiFeatureConfigOf({
  process,
  installed,
}: {
  process: ProcessWebConfig;
  installed: InstalledUiConfig;
}): UiFeatureConfig {
  return { ...installed, process };
}

export function uiDeploymentOf({
  config,
  origin,
}: {
  config: UiFeatureConfig;
  origin: string;
}): UiDeployment {
  return deriveUiDeployment({
    process: config.process,
    origin,
    ...config.auth,
    ...config.authz,
    ...config.billing,
    ...config.evaluator,
    ...config.notification,
    hasCloudOps: config.ops.cloudOps,
    ...config.gateway,
  });
}

export function uiTelemetryOf(config: UiFeatureConfig): UiPublicTelemetry {
  return { mode: config.process.mode, telemetry: { ...config.ops } };
}
