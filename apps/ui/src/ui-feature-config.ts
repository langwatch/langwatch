import { authWebConfigSchema } from "@langwatch/auth-contract";
import { authzWebConfigSchema } from "@langwatch/authz-contract";
import type { UiDeployment } from "@langwatch/browser-host/capabilities";
import { deriveUiDeployment } from "@langwatch/browser-host/deployment";
import {
  parsePublicConfigSlice,
  processWebConfigSchema,
  type PublicAppConfig,
} from "@langwatch/config/public-app-config";
import { billingWebConfigSchema } from "@langwatch/enterprise-billing-contract";
import { evaluationWebConfigSchema } from "@langwatch/evaluation-contract";
import { gatewayWebConfigSchema } from "@langwatch/gateway-contract";
import { notificationWebConfigSchema } from "@langwatch/notification-contract";
import { opsWebConfigSchema } from "@langwatch/ops-contract";
import type { UiPublicTelemetry } from "@langwatch/ui-kernel/inner-providers";
import type { output, ZodType } from "zod";

/** Each owner's slice of the page's config, checked by its contract's schema before any render. */
export type UiFeatureConfig = Readonly<{
  process: output<typeof processWebConfigSchema>;
  auth: output<typeof authWebConfigSchema>;
  authz: output<typeof authzWebConfigSchema>;
  billing: output<typeof billingWebConfigSchema>;
  evaluation: output<typeof evaluationWebConfigSchema>;
  gateway: output<typeof gatewayWebConfigSchema>;
  notification: output<typeof notificationWebConfigSchema>;
  ops: output<typeof opsWebConfigSchema>;
}>;

export function parseUiFeatureConfig(config: PublicAppConfig): UiFeatureConfig {
  const slice = <Schema extends ZodType>(owner: string, schema: Schema): output<Schema> =>
    parsePublicConfigSlice({ config, owner, schema });
  return {
    process: slice("process", processWebConfigSchema),
    auth: slice("auth", authWebConfigSchema),
    authz: slice("authz", authzWebConfigSchema),
    billing: slice("billing", billingWebConfigSchema),
    evaluation: slice("evaluation", evaluationWebConfigSchema),
    gateway: slice("gateway", gatewayWebConfigSchema),
    notification: slice("notification", notificationWebConfigSchema),
    ops: slice("ops", opsWebConfigSchema),
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
    ...config.authz,
    ...config.billing,
    hasLangevals: config.evaluation.langevals,
    hasEmailProvider: config.notification.email,
    ...(config.auth.authProvider ? { authProvider: config.auth.authProvider } : {}),
    passkeysEnabled: config.auth.passkeys,
  });
}

export function uiTelemetryOf(config: UiFeatureConfig): UiPublicTelemetry {
  return {
    mode: config.process.mode,
    telemetry: {
      browserTracing: config.process.browserTracing,
      sampleRatio: config.process.sampleRatio,
      ...config.ops,
    },
  };
}
