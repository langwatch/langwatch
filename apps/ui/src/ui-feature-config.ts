import type { RequiredUiConfig } from "@langwatch/browser";
import type { UiDeployment } from "@langwatch/browser-host/capabilities";
import { deriveUiDeployment } from "@langwatch/browser-host/deployment";
import type { UiPublicTelemetry } from "@langwatch/browser/inner-providers";
import {
  parsePublicConfigSlice,
  type ProcessWebConfig,
  type PublicAppConfig,
} from "@langwatch/config/public-app-config";
import { notificationWebConfigSchema } from "@langwatch/notification-contract";
import { opsWebConfigSchema } from "@langwatch/ops-contract";
import { rumWebConfigSchema } from "@langwatch/rum-contract";
import type { output } from "zod";

import type { browserModules } from "./browser-modules.generated.ts";

/** What each installed web module projected from the slices it claims, by module name. */
export type InstalledUiConfig = RequiredUiConfig<typeof browserModules>;

/**
 * Interim: notification's and ops's browser halves do not yet depend on the
 * notification and rum contracts, so these three slices are read here, shaped
 * as those claims will project them (handoff browser-config-claims §12).
 */
const UNCLAIMED_OWNERS = ["notification", "ops", "rum"] as const;

type UnclaimedUiConfig = Readonly<{
  notification: Readonly<{ hasEmailProvider: boolean }>;
  ops: UiPublicTelemetry["telemetry"] & output<typeof opsWebConfigSchema>;
}>;

/** The process owner's slice, then every installed module's projection. */
export type UiFeatureConfig = Readonly<{ process: ProcessWebConfig }> &
  InstalledUiConfig &
  UnclaimedUiConfig;

/** The envelope the supply checks: the served one, less the slices still read here. */
export function claimedPublicConfig(served: PublicAppConfig): PublicAppConfig {
  return Object.fromEntries(
    Object.entries(served).filter(
      ([owner]) => !(UNCLAIMED_OWNERS as readonly string[]).includes(owner),
    ),
  );
}

export function uiFeatureConfigOf({
  served,
  process,
  installed,
}: {
  served: PublicAppConfig;
  process: ProcessWebConfig;
  installed: InstalledUiConfig;
}): UiFeatureConfig {
  const notification = parsePublicConfigSlice({
    config: served,
    owner: "notification",
    schema: notificationWebConfigSchema,
  });
  const ops = parsePublicConfigSlice({ config: served, owner: "ops", schema: opsWebConfigSchema });
  const rum = parsePublicConfigSlice({ config: served, owner: "rum", schema: rumWebConfigSchema });
  return {
    ...installed,
    process,
    notification: { hasEmailProvider: notification.email },
    ops: { browserTracing: rum.enabled, sampleRatio: rum.sampleRatio, ...ops },
  };
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
