import {
  ModelProviderTestRateLimitedError,
  findModelProviderDefinition,
  importsModelListing,
  isSameEndpoint,
  type Model,
  type ModelImportOutcome,
  type ModelProvider,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

import { mergeListedModels } from "../../../rules/model-listing-import.rules.ts";
import type { ModelProviderConnectionRateLimiter } from "../../credential-probe/services/windowed-model-provider-connection-rate-limiter.service.ts";
import type { ModelProviderModelList } from "./http-model-provider-model-list.service.ts";

const logger = createLogger("langwatch:model-provider:model-import");

/** The provider value a save is about to store, before the import folds into it. */
type ModelImportWrite = Readonly<{
  organizationId: string;
  provider: string;
  enabled: boolean;
  /** The credential the save stores: incoming fields over the stored ones, never masked. */
  customKeys: Record<string, unknown> | null;
  customModels: Model[];
  customEmbeddingsModels: Model[];
}>;

/** What the save writes from the import; a field left out keeps the save's own value. */
type ModelImportResult = Readonly<{
  outcome?: ModelImportOutcome;
  customModels?: Model[];
  customEmbeddingsModels?: Model[];
  lastListedModelIds?: string[];
}>;

/**
 * Imports the models an OpenAI-compatible provider lists into the lists a save writes, asked with
 * the credential the save stores. It never throws: any failure leaves the save as it was sent.
 * Spec: specs/model-providers/custom-provider-model-import.feature
 */
export class ModelProviderModelImportService {
  static create(input: {
    modelList: ModelProviderModelList;
    connectionRateLimiter: ModelProviderConnectionRateLimiter;
  }): ModelProviderModelImportService {
    return new ModelProviderModelImportService(input.modelList, input.connectionRateLimiter);
  }

  private constructor(
    private readonly modelList: ModelProviderModelList,
    private readonly connectionRateLimiter: ModelProviderConnectionRateLimiter,
  ) {}

  /** The save's provider value with its listed models folded in, and what the import did. */
  async importIntoSave({
    provider,
    existing,
  }: {
    provider: ModelProvider;
    existing: ModelProvider | null;
  }): Promise<{ provider: ModelProvider; outcome?: ModelImportOutcome }> {
    const result = await this.importOnSave({ write: provider, existing });
    return { provider: withImportedModels(provider, result), outcome: result.outcome };
  }

  private async importOnSave({
    write,
    existing,
  }: {
    write: ModelImportWrite;
    existing: ModelProvider | null;
  }): Promise<ModelImportResult> {
    const keys = write.customKeys;
    // A managed row's credential is not the customer's to probe with.
    if (!keys || "MANAGED" in keys) return {};
    const endpointKey = findModelProviderDefinition(write.provider)?.endpointKey;
    const endpoint = endpointKey ? textOf(keys[endpointKey]) : "";
    if (!importsModelListing({ provider: write.provider, baseUrl: endpoint })) return {};

    // Stored ids belong to the endpoint that listed them; a move clears them even unlisted.
    const sameEndpoint = isSameListingEndpoint({ existing, endpointKey, endpoint });
    const notListed = (outcome?: ModelImportOutcome): ModelImportResult => ({
      outcome,
      ...(existing && !sameEndpoint && { lastListedModelIds: [] }),
    });
    if (!write.enabled) return notListed();

    const budget = await this.spendCheckBudget(write);
    if (budget !== "allowed") {
      return notListed({ status: budget === "exhausted" ? "skipped" : "failed" });
    }

    const listed = await this.modelList
      .findListedModels({ provider: write.provider, customKeys: keys })
      .catch((error: unknown) => {
        logger.warn({ provider: write.provider, error }, "Could not list models on save");
        return null;
      });
    if (!listed) return notListed({ status: "failed" });

    const merged = mergeListedModels({
      listed,
      customModels: write.customModels,
      customEmbeddingsModels: write.customEmbeddingsModels,
      previouslyListedIds: sameEndpoint ? (existing?.lastListedModelIds ?? null) : null,
    });
    return {
      outcome: { status: "imported", added: merged.added, total: listed.length },
      customModels: merged.customModels,
      customEmbeddingsModels: merged.customEmbeddingsModels,
      lastListedModelIds: merged.listedModelIds,
    };
  }

  /** The probe is outbound traffic to a URL the customer chose: it spends a connection test. */
  private async spendCheckBudget(
    write: ModelImportWrite,
  ): Promise<"allowed" | "exhausted" | "unavailable"> {
    try {
      await this.connectionRateLimiter.assertAvailable({ organizationId: write.organizationId });
      return "allowed";
    } catch (error) {
      const exhausted = error instanceof ModelProviderTestRateLimitedError;
      logger.warn(
        { provider: write.provider, ...(exhausted ? {} : { error }) },
        exhausted
          ? "Skipped the model import on save: check budget used up"
          : "Skipped the model import on save: check budget unreadable",
      );
      return exhausted ? "exhausted" : "unavailable";
    }
  }
}

/** A credential field as text; anything not a string reads as no value. */
const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

/** A key rotation on the same endpoint keeps the listing history; a new endpoint starts fresh. */
function isSameListingEndpoint({
  existing,
  endpointKey,
  endpoint,
}: {
  existing: ModelProvider | null;
  endpointKey: string | undefined;
  endpoint: string;
}): boolean {
  if (!existing) return false;
  if (!endpointKey) return true;
  const stored = textOf(existing.customKeys?.[endpointKey]);
  if (stored === "" || endpoint === "") return stored === endpoint;
  return isSameEndpoint(stored, endpoint);
}

/** The provider value with what the save imported from its model listing folded in. */
function withImportedModels(provider: ModelProvider, result: ModelImportResult): ModelProvider {
  return {
    ...provider,
    ...(result.customModels && { customModels: result.customModels }),
    ...(result.customEmbeddingsModels && {
      customEmbeddingsModels: result.customEmbeddingsModels,
    }),
    ...(result.lastListedModelIds && { lastListedModelIds: result.lastListedModelIds }),
  };
}
