/**
 * Managed models, the two sides of it (ADR-141 section 8).
 *
 * On a connected self-hosted install: the extra provider slot that puts the
 * LangWatch gateway in front of every virtual key of an organization that
 * switched the service on. The license token is read at materialisation and
 * never stored on a `ModelProvider` row, so revoking the license is the whole
 * of taking the provider away.
 *
 * On LangWatch Cloud: the providers a license's managed key dispatches to.
 * A license token reaches none of the customer organization's own credentials
 * (`eligibleModelProvidersForVk` refuses a CONNECT key outright), so hosted
 * traffic runs on the platform's own environment keys, the same ones a SaaS
 * organization inherits.
 *
 * Spec: specs/self-hosting/connected-services/managed-models-provider.feature
 */

import { readConnectConfig } from "@ee/licensing/connect/install/connectConfig";
import { resolveConnectCredential } from "@ee/licensing/connect/install/connectCredential";
import { connectServiceEnabled } from "@ee/licensing/connect/install/connectEntitlement";
import type { ModelProvider, PrismaClient } from "~/generated/prisma/client";
import { modelProviders } from "../modelProviders/registry";
import type { ProviderSlot } from "./config.materialiser";

/** The entitlement, spelled the way the registry and the install spell it. */
export const MANAGED_MODELS = "managed_models";

/**
 * The ModelProvider row id the synthesized slot carries. A fixed id rather than
 * a generated one: the gateway keys credentials, budgets and the provider
 * allowlist on it, and a value that moved between materialisations would make
 * the same provider look like a different one on every config refresh.
 */
export const CONNECT_LANGWATCH_PROVIDER_ID = "connect-langwatch";

/**
 * The LangWatch provider slot for one organization, or null when there is none
 * to add: Connect switched off for the deployment, the service not switched on
 * for the organization, or no license to present.
 *
 * The slot is appended after the organization's own providers, so a customer
 * credential that serves the model keeps serving it and LangWatch is reached
 * only where the caller named it.
 */
export async function connectLangWatchProviderSlot({
  prisma,
  organizationId,
  slot,
}: {
  prisma: PrismaClient;
  organizationId: string;
  slot: string;
}): Promise<ProviderSlot | null> {
  const config = readConnectConfig();
  if (!config.permitted) return null;

  const enabled = await connectServiceEnabled({
    prisma,
    organizationId,
    service: MANAGED_MODELS,
  });
  if (!enabled) return null;

  const credential = await resolveConnectCredential({
    prisma,
    organizationId,
  });
  if (!credential) return null;

  return {
    id: CONNECT_LANGWATCH_PROVIDER_ID,
    slot,
    type: "langwatch",
    credentials: {
      api_key: credential.token,
      instance_id: credential.instanceId,
    },
    base_url: `${config.gatewayEndpoint.replace(/\/+$/, "")}/v1`,
    models: [],
    config: {},
  };
}

/**
 * The providers the platform holds its own keys for, as the dispatch chain of
 * a license's managed key.
 *
 * Synthesized rather than read: these are environment keys of the deployment,
 * not rows an organization owns, and writing them into `ModelProvider` would
 * put the platform's credentials inside a customer tenant. The rows carry the
 * shape `buildProviderSlot` reads and nothing else.
 *
 * A provider with no key in the environment is left out, so the chain never
 * offers a credential that cannot authenticate.
 */
export function platformSharedModelProviders(
  organizationId: string,
): ModelProvider[] {
  const at = new Date(0);
  return Object.entries(modelProviders)
    .filter(([, entry]) => entry.type === "llm" && entry.enabledSince)
    .map(([provider, entry]) => ({ provider, apiKey: entry.apiKey }))
    .filter(({ apiKey }) => Boolean(process.env[apiKey]))
    .map(({ provider, apiKey }, index) =>
      platformProviderRow({
        organizationId,
        provider,
        apiKey,
        createdAt: new Date(at.getTime() + index),
      }),
    );
}

/**
 * One synthesized row. `customKeys` is the plain credential bag rather than the
 * encrypted column, which `readCustomKeys` accepts: there is nothing at rest to
 * decrypt here, the key comes from the process environment on every read.
 */
function platformProviderRow({
  organizationId,
  provider,
  apiKey,
  createdAt,
}: {
  organizationId: string;
  provider: string;
  apiKey: string;
  createdAt: Date;
}): ModelProvider {
  return {
    id: `platform-${provider}`,
    organizationId,
    name: provider,
    provider,
    routingHandle: null,
    enabled: true,
    customKeys: { [apiKey]: process.env[apiKey] ?? "" },
    extraHeaders: null,
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    rotationPolicy: "MANUAL",
    providerConfig: null,
    fallbackPriorityGlobal: null,
    langySkipPermissionsModels: null,
    healthStatus: "HEALTHY",
    circuitOpenedAt: null,
    lastHealthCheckAt: null,
    disabledAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}
