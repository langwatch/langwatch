/**
 * Reads the stored ElevenLabs credential for one provider row. Two callers need it with no session to authorize with (the webhook route authenticated by vendor HMAC, and the background reconciler), so ModelProviderService (which takes an authz context) doesn't fit — this is the service layer for both. Nothing here throws: a provider that can't serve is null, and each caller decides what that means (webhook 404s so ids can't be probed; reconciler leaves the session for spend grace).
 */

import { createLogger } from "@langwatch/observability";
import type { GatewayElevenLabsCredentialRepository } from "../repositories/gateway-elevenlabs-credential.repository";
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
 * What the two reads reach outside themselves: the provider rows, and the
 * Model Provider feature's own credential reader, which owns the cipher.
 */
export type ElevenLabsCredentialCollaborators = {
  providers: GatewayElevenLabsCredentialRepository;
  credentials: GatewayModelProviderCredentialsPort;
};

export class GatewayElevenLabsCredentialService {
  private constructor(private readonly collaborators: ElevenLabsCredentialCollaborators) {}

  static create(
    collaborators: ElevenLabsCredentialCollaborators,
  ): GatewayElevenLabsCredentialService {
    return new GatewayElevenLabsCredentialService(collaborators);
  }

  /** The decrypted custom keys of an ElevenLabs row, or null for anything else. */
  private async elevenLabsKeys(modelProviderId: string): Promise<{
    keys: Record<string, unknown>;
    organizationId: string;
  } | null> {
    const collaborators = this.collaborators;
    const provider = await collaborators.providers.tryFindProviderRow({ modelProviderId });
    if (provider?.provider !== "elevenlabs") {
      return null;
    }

    return {
      keys: collaborators.credentials.readCustomKeys(provider.customKeys),
      organizationId: provider.organizationId,
    };
  }

  /**
   * Workspace post-call webhook secret on one provider row. Organization comes back with it since the webhook has no other way to know whose session a delivery may close — tenant is the path parameter, so the match scopes to the org owning the secret the delivery was signed with.
   */
  async tryGetWebhookSecret({
    modelProviderId,
  }: {
    modelProviderId: string;
  }): Promise<ElevenLabsWebhookSecret | null> {
    const row = await this.elevenLabsKeys(modelProviderId);
    if (!row) {
      return null;
    }

    const secret = row.keys[ELEVENLABS_WEBHOOK_SECRET_KEY];
    if (typeof secret !== "string" || secret.length === 0) {
      return null;
    }

    return { secret, organizationId: row.organizationId };
  }

  /**
   * API key and host to read a conversation back with. Host is validated here as well as on write, since a row stored before the registry constrained the field could send the customer's API key to whatever host it names (SSRF policy only refuses private addresses) — a bad host falls back to the vendor default rather than refusing, since the reconciler still has a real call to settle.
   */
  async tryGetApiCredential({
    modelProviderId,
  }: {
    modelProviderId: string;
  }): Promise<ElevenLabsApiCredential | null> {
    const row = await this.elevenLabsKeys(modelProviderId);
    if (!row) {
      return null;
    }

    const apiKey = row.keys.ELEVENLABS_API_KEY;
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return null;
    }

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
}
