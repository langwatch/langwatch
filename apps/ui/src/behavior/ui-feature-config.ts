import { authWebConfigSchema } from "@langwatch/auth-contract";
import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { billingWebConfigSchema } from "@langwatch/enterprise-billing-contract";
import { saasWebConfigSchema } from "@langwatch/enterprise-saas-contract";
import { evaluationWebConfigSchema } from "@langwatch/evaluation-contract";
import { gatewayWebConfigSchema } from "@langwatch/gateway-contract";
import { notificationWebConfigSchema } from "@langwatch/notification-contract";
import { opsWebConfigSchema } from "@langwatch/ops-contract";
import { workflowWebConfigSchema } from "@langwatch/workflow-contract";

/**
 * Each feature's own reading of the public application configuration.
 *
 * The wire contract is one document, injected into the HTML shell by the API
 * and parsed back out by the browser. What is per feature is the slice each
 * one acts on, and every slice is checked here — at boot, before the first
 * render — so a browser never draws a screen over a value its feature would
 * have refused.
 */
export type UiFeatureConfig = Readonly<{
  auth: ReturnType<typeof authWebConfigSchema.parse>;
  billing: ReturnType<typeof billingWebConfigSchema.parse>;
  deployment: ReturnType<typeof saasWebConfigSchema.parse>;
  evaluation: ReturnType<typeof evaluationWebConfigSchema.parse>;
  gateway: ReturnType<typeof gatewayWebConfigSchema.parse>;
  notification: ReturnType<typeof notificationWebConfigSchema.parse>;
  observability: ReturnType<typeof opsWebConfigSchema.parse>;
  workflow: ReturnType<typeof workflowWebConfigSchema.parse>;
}>;

export function parseUiFeatureConfig(config: PublicAppConfig): UiFeatureConfig {
  return {
    auth: authWebConfigSchema.parse({
      passkeys: config.passkeys,
      identityFrontDoor: config.identityFrontDoor,
    }),
    billing: billingWebConfigSchema.parse({ licensePaymentUrl: config.licensePaymentUrl }),
    deployment: saasWebConfigSchema.parse({ deployment: config.deployment }),
    evaluation: evaluationWebConfigSchema.parse({ langevals: config.capabilities.langevals }),
    gateway: gatewayWebConfigSchema.parse({ gatewayBaseUrl: config.gatewayBaseUrl }),
    notification: notificationWebConfigSchema.parse({ email: config.capabilities.email }),
    observability: opsWebConfigSchema.parse(config.telemetry),
    workflow: workflowWebConfigSchema.parse({ nlp: config.capabilities.nlp }),
  };
}
