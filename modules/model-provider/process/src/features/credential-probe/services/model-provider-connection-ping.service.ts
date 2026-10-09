import {
  CODEX_PROVIDER_KEY,
  CODING_ASSISTANT_SURFACES_ONLY_NEEDLE,
  CONNECTION_TEST_FEATURE_KEY,
  isModelAllowedForFeature,
  ProviderKeyInvalidError,
  ProviderOutOfCreditError,
  ProviderRefusedError,
  ProviderUnreachableError,
  ProviderUsageLimitError,
  findModelProviderDefinition,
  type ModelProvider,
  type ModelProviderApi,
  type ModelProviderCredentialVerdict,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { LANGY_VK_SECRET_NAME, type SecretApi } from "@langwatch/secret-contract";

import type { ModelProviderCodexGatewayPing } from "../../../channels/model-provider-codex-gateway-ping.channel.ts";
import type {
  ModelProviderConnectionPing,
  ModelProviderPingReply,
} from "../../../channels/model-provider-connection-ping.channel.ts";
import {
  UNPINGABLE_CREDENTIALS,
  classifyPingRefusal,
  findPingModels,
} from "../../../rules/provider-ping.rules.ts";

const logger = createLogger("langwatch:modelProviders:connectionPing");

type FailedPing = Extract<ModelProviderPingReply, { outcome: "failed" }>;

type ModelProviderConnectionPingOptions = {
  channel: ModelProviderConnectionPing;
  /** Codex's only road: the AI gateway, on the project's Langy virtual key. */
  codexChannel: ModelProviderCodexGatewayPing;
  secrets: Pick<SecretApi, "getValues">;
  modelProviders: Pick<ModelProviderApi, "prepareExecution">;
};

const NO_GATEWAY_CREDENTIAL =
  "No gateway credential could be provisioned for this project yet - open Langy once, or re-connect Codex.";

/** A failure raised before anything was sent: read as unreachable, as main's thrown error was. */
function unsent(message: string): FailedPing {
  return { outcome: "failed", status: undefined, message, responseBody: "", thrownAs: "Error" };
}

/**
 * Test Connection's verdict: one real generation on the row's own credential, after the
 * credential check. The provider's own words never reach the verdict.
 * Spec: specs/model-providers/credential-validation.feature
 */
export class ModelProviderConnectionPingService {
  private constructor(private readonly options: ModelProviderConnectionPingOptions) {}

  static create(options: ModelProviderConnectionPingOptions): ModelProviderConnectionPingService {
    return new ModelProviderConnectionPingService(options);
  }

  async verify({
    row,
    projectId,
    credential,
  }: {
    row: Pick<ModelProvider, "id" | "provider" | "customModels">;
    projectId: string | undefined;
    credential: ModelProviderCredentialVerdict;
  }): Promise<ModelProviderCredentialVerdict> {
    if (credential.outcome === "refused") return credential;
    if (credential.outcome === "unchecked" && UNPINGABLE_CREDENTIALS.includes(credential.reason)) {
      return credential;
    }
    const definition = findModelProviderDefinition(row.provider);
    const [model] = findPingModels(row);
    if (!projectId || !model || definition?.type !== "llm") return credential;

    const reply =
      row.provider === CODEX_PROVIDER_KEY
        ? await this.sendThroughGateway({ model, projectId })
        : await this.send({ row, model, projectId });
    if (reply.outcome === "generated") return { outcome: "verified", valid: true };
    return this.refusalOf({
      provider: row.provider,
      failure: reply,
      hasConfigurableEndpoint: !!definition.endpointKey,
    });
  }

  private async send({
    row,
    model,
    projectId,
  }: {
    row: Pick<ModelProvider, "id" | "provider">;
    model: string;
    projectId: string;
  }): Promise<ModelProviderPingReply> {
    try {
      const parameters = await this.options.modelProviders.prepareExecution({
        model: `${row.id}/${model}`,
        projectId,
      });
      return await this.options.channel.ping({
        providerKey: row.provider,
        model: `${row.provider}/${model}`,
        parameters,
      });
    } catch (error) {
      return {
        outcome: "failed",
        status: undefined,
        message: "",
        responseBody: "",
        thrownAs: error instanceof Error && error.name ? error.name : typeof error,
      };
    }
  }

  /** Spec: specs/model-providers/codex-account-provider.feature */
  private async sendThroughGateway({
    model,
    projectId,
  }: {
    model: string;
    projectId: string;
  }): Promise<ModelProviderPingReply> {
    const modelId = `${CODEX_PROVIDER_KEY}/${model}`;
    if (!isModelAllowedForFeature({ modelId, featureKey: CONNECTION_TEST_FEATURE_KEY })) {
      return unsent(
        `"${modelId}" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot run "${CONNECTION_TEST_FEATURE_KEY}".`,
      );
    }
    try {
      const stored = await this.options.secrets.getValues({ projectId });
      const virtualKey = stored[LANGY_VK_SECRET_NAME];
      if (!virtualKey) return unsent(NO_GATEWAY_CREDENTIAL);
      return await this.options.codexChannel.ping({ model: modelId, virtualKey });
    } catch (error) {
      return unsent(error instanceof Error ? error.message : String(error));
    }
  }

  /** A failure carrying neither a status nor a body never reached the provider. */
  private refusalOf({
    provider,
    failure,
    hasConfigurableEndpoint,
  }: {
    provider: string;
    failure: FailedPing;
    hasConfigurableEndpoint: boolean;
  }): ModelProviderCredentialVerdict {
    const { status, message, responseBody, thrownAs } = failure;
    const hasAnswered = status !== undefined || responseBody !== "";
    const classified = hasAnswered
      ? classifyPingRefusal({ status, body: `${message} ${responseBody}` })
      : "unreachable";
    logger.info(
      { provider, status, classifiedAs: classified },
      `Connection ping refused (provider ${provider}, as ${classified}, ${
        status === undefined ? "no HTTP status" : `HTTP ${status}`
      }, thrown as ${thrownAs})`,
    );
    const refusal = {
      unreachable: () => new ProviderUnreachableError({ provider, hasConfigurableEndpoint }),
      credit: () => new ProviderOutOfCreditError({ provider }),
      usage_limit: () => new ProviderUsageLimitError({ provider }),
      auth: () => new ProviderKeyInvalidError({ provider }),
      other: () => new ProviderRefusedError({ provider, status: status ?? 502 }),
    }[classified];
    return { outcome: "refused", valid: false, domainError: refusal().serialize() };
  }
}
