import {
  codexTokenKeysSchema,
  modelProviderCodexGatewayRefreshInputSchema,
  modelProviderCodexGatewayRefreshSchema,
  modelProviderCodexStatusInputSchema,
  modelProviderCodexStatusSchema,
  type ModelProviderCodexGatewayRefresh,
  type ModelProviderCodexStatus,
  type ModelProviderCodexStatusInput,
} from "@langwatch/model-provider-contract";
import type {
  CodexTokenRefresher,
  ModelProviderRepository,
} from "../ports/model-provider.port";
import type { ModelProviderQueryService } from "./model-provider-query.service";

type ModelProviderCodexOptions = {
  repository: ModelProviderRepository;
  query: ModelProviderQueryService;
  tokenRefresher: CodexTokenRefresher;
};

export class ModelProviderCodexService {
  private constructor(private readonly options: ModelProviderCodexOptions) {}

  static create(options: ModelProviderCodexOptions): ModelProviderCodexService {
    return new ModelProviderCodexService(options);
  }

  async getStatus(
    input: ModelProviderCodexStatusInput,
  ): Promise<ModelProviderCodexStatus> {
    const parsed = modelProviderCodexStatusInputSchema.parse(input);
    const provider = await this.options.query.tryGetProviderForProject({
      provider: "openai_codex",
      projectId: parsed.projectId,
    });
    if (!provider?.enabled) {
      return modelProviderCodexStatusSchema.parse({ connected: false });
    }

    const plan = provider.customKeys?.CODEX_PLAN;
    return modelProviderCodexStatusSchema.parse({
      connected: true,
      providerId: provider.id,
      plan: typeof plan === "string" ? plan : "",
    });
  }

  async refreshForGateway(input: {
    providerRowId: string;
  }): Promise<ModelProviderCodexGatewayRefresh> {
    const parsed = modelProviderCodexGatewayRefreshInputSchema.parse(input);
    const provider = await this.options.repository.tryFindById({
      id: parsed.providerRowId,
    });
    if (provider?.provider !== "openai_codex") {
      return modelProviderCodexGatewayRefreshSchema.parse({ status: "not_connected" });
    }

    const parsedKeys = codexTokenKeysSchema.safeParse(provider.customKeys ?? {});
    if (!parsedKeys.success) {
      return modelProviderCodexGatewayRefreshSchema.parse({ status: "not_connected" });
    }

    const keys = parsedKeys.data;
    if (isRecent(keys.CODEX_TOKENS_SAVED_AT)) {
      return modelProviderCodexGatewayRefreshSchema.parse({
        status: "refreshed",
        accessToken: keys.CODEX_ACCESS_TOKEN,
        accountId: keys.CODEX_ACCOUNT_ID,
      });
    }

    const refreshed = await this.options.tokenRefresher.refresh({ tokens: keys });
    if (refreshed.status === "session_expired") {
      return modelProviderCodexGatewayRefreshSchema.parse({ status: "session_expired" });
    }

    await this.options.repository.update({ ...provider, customKeys: refreshed.tokens });
    return modelProviderCodexGatewayRefreshSchema.parse({
      status: "refreshed",
      accessToken: refreshed.tokens.CODEX_ACCESS_TOKEN,
      accountId: refreshed.tokens.CODEX_ACCOUNT_ID,
    });
  }
}

function isRecent(savedAt: string): boolean {
  const savedAtMs = Date.parse(savedAt);
  return Number.isFinite(savedAtMs) && Date.now() - savedAtMs < 30_000;
}
