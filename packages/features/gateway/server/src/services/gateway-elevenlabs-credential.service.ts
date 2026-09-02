/**
 * Reads the stored ElevenLabs credential for one provider row.
 *
 * Two callers need it and neither has a session to authorize with. The
 * post-call webhook route is authenticated by the vendor's HMAC, and the
 * reconciler is a background worker, so `ModelProviderService` does not fit:
 * it takes an authz context. This is the service layer for both, which keeps
 * the Prisma query and the decryption out of the route and out of the worker.
 *
 * Nothing here throws. A provider that cannot serve is `null`, and each
 * caller decides what that means: the webhook answers 404 so the ids cannot
 * be probed, and the reconciler leaves the session for the spend grace.
 */

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayModelProviderCredentialsPort } from "../ports/gateway-model-provider-credentials.port";
import { isElevenLabsHost } from "@langwatch/model-provider-contract";

const logger = createLogger("langwatch:gateway:elevenlabs-credential");

/** The custom key an operator stores the workspace webhook secret under. */
export const ELEVENLABS_WEBHOOK_SECRET_KEY = "ELEVENLABS_WEBHOOK_SECRET";

/** The vendor's default host, used when the row names none or names a bad one. */
export const ELEVENLABS_DEFAULT_BASE_URL = "https://api.elevenlabs.io";

export interface ElevenLabsWebhookSecret {
  secret: string;
  organizationId: string;
}

export interface ElevenLabsApiCredential {
  apiKey: string;
  baseUrl: string;
}

/**
 * What the two reads reach outside themselves: the deployment's database and
 * the Model Provider feature's own credential reader, which owns the cipher.
 */
export type ElevenLabsCredentialCollaborators = {
  database: PrismaClient;
  credentials: GatewayModelProviderCredentialsPort;
};

/** The decrypted custom keys of an ElevenLabs row, or null for anything else. */
async function elevenLabsKeys(
  modelProviderId: string,
  collaborators: ElevenLabsCredentialCollaborators,
): Promise<{
  keys: Record<string, unknown>;
  organizationId: string;
} | null> {
  const provider = await collaborators.database.modelProvider.findUnique({
    where: { id: modelProviderId },
    select: { provider: true, organizationId: true, customKeys: true },
  });
  if (provider?.provider !== "elevenlabs") return null;
  return {
    keys: collaborators.credentials.readCustomKeys(provider.customKeys),
    organizationId: provider.organizationId,
  };
}

/**
 * The workspace post-call webhook secret stored on one provider row.
 *
 * The organization comes back with it because the webhook has no other way to
 * know whose session a delivery may close: the tenant is the path parameter,
 * and the match has to be scoped to the organization that owns the secret the
 * delivery was signed with.
 */
export async function getElevenLabsWebhookSecret({
  modelProviderId,
  collaborators,
}: {
  modelProviderId: string;
  collaborators: ElevenLabsCredentialCollaborators;
}): Promise<ElevenLabsWebhookSecret | null> {
  const row = await elevenLabsKeys(modelProviderId, collaborators);
  if (!row) return null;
  const secret = row.keys[ELEVENLABS_WEBHOOK_SECRET_KEY];
  if (typeof secret !== "string" || secret.length === 0) return null;
  return { secret, organizationId: row.organizationId };
}

/**
 * The API key and host to read a conversation back with.
 *
 * The host is validated here as well as on write. A row stored before the
 * registry constrained the field would otherwise send the customer's API key
 * to whatever host it names, and the SSRF policy only refuses private
 * addresses. A bad host falls back to the vendor default rather than
 * refusing, because the reconciler still has a real call to settle.
 */
export async function getElevenLabsApiCredential({
  modelProviderId,
  collaborators,
}: {
  modelProviderId: string;
  collaborators: ElevenLabsCredentialCollaborators;
}): Promise<ElevenLabsApiCredential | null> {
  const row = await elevenLabsKeys(modelProviderId, collaborators);
  if (!row) return null;
  const apiKey = row.keys.ELEVENLABS_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) return null;

  const configured = row.keys.ELEVENLABS_BASE_URL;
  if (typeof configured !== "string" || configured.length === 0) {
    return { apiKey, baseUrl: ELEVENLABS_DEFAULT_BASE_URL };
  }
  if (!isElevenLabsHost(configured)) {
    logger.warn(
      { modelProviderId },
      "an ElevenLabs credential names a base URL outside elevenlabs.io; using the default host instead",
    );
    return { apiKey, baseUrl: ELEVENLABS_DEFAULT_BASE_URL };
  }
  return { apiKey, baseUrl: configured.replace(/\/$/, "") };
}
