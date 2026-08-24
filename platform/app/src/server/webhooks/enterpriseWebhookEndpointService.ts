import {
  WebhookEndpointConfiguration,
  AppWebhookEntitlementRuntime,
  WebhookEntitlementService,
  WebhookIdPort,
  WebhookPlanPort,
  WebhookSecretPort,
  createWebhookEndpointService,
  type WebhookEndpointRuntime,
  type WebhookEndpointServiceOptions,
} from "~/runtime/app/features/webhooks";
import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import { decrypt, encrypt } from "~/utils/encryption";
import { pruneWebhookDeliveries } from "./deliveryLog";

class AppWebhookIdAdapter extends WebhookIdPort {
  newEndpointId(): string {
    return generate(KSUID_RESOURCES.WEBHOOK_ENDPOINT).toString();
  }
}

class AppWebhookSecretAdapter extends WebhookSecretPort {
  encrypt(value: string): string {
    return encrypt(value);
  }

  decrypt(value: string): string {
    return decrypt(value);
  }
}

class AppWebhookPlanAdapter extends WebhookPlanPort {
  constructor(
    private readonly resolve: (
      organizationId: string,
    ) => Promise<{ webhookEndpointsEnabled?: boolean }>,
  ) {
    super();
  }

  async hasWebhookEndpoints(organizationId: string): Promise<boolean> {
    return (await this.resolve(organizationId)).webhookEndpointsEnabled === true;
  }
}

const ids = new AppWebhookIdAdapter();
const secrets = new AppWebhookSecretAdapter();

export function createEnterpriseWebhookEndpointService(
  input: {
    prisma: PrismaClient;
  } & Pick<WebhookEndpointServiceOptions, "notifyAutoDisabled">,
): WebhookEndpointRuntime {
  return createWebhookEndpointService({
    ...input,
    ids,
    secrets,
    configuration: WebhookEndpointConfiguration.create({
      allowInsecureLocalUrls:
        process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS === "1",
      allowAmbientAwsCredentials:
        process.env.WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS === "1",
    }),
    pruneDeliveries: (now) => pruneWebhookDeliveries({ prisma: input.prisma, now }),
  });
}

export function installEnterpriseWebhookEntitlement(
  resolve: (
    organizationId: string,
  ) => Promise<{ webhookEndpointsEnabled?: boolean }>,
): void {
  AppWebhookEntitlementRuntime.install(
    WebhookEntitlementService.create(new AppWebhookPlanAdapter(resolve)),
  );
}
