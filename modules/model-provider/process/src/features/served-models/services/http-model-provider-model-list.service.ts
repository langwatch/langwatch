import {
  MASKED_KEY_PLACEHOLDER,
  findModelProviderDefinition,
} from "@langwatch/model-provider-contract";

import {
  type ListedModel,
  readModelListing,
  readModelListingText,
} from "../../../rules/model-listing.rules.ts";
import {
  type AuthStrategy,
  type DeployedBaseUrls,
  NOT_PROBEABLE,
  PROBE_NEEDS_MODEL,
  PROVIDER_AUTH_OVERRIDES,
  VALIDATION_ONLY_BASE_URLS,
  providerApiRoots,
  providerDefaultBaseUrls,
} from "../../../rules/model-provider-probe-targets.rules.ts";
import { buildProbeCandidates } from "../../credential-probe/services/model-provider-probe-chain.service.ts";
import type { ModelProviderEgress } from "../../credential-probe/services/ssrf-model-provider-egress.service.ts";

/** Asks a provider which models its credential can call, through the process's egress fence. */
export abstract class ModelProviderModelList {
  /** The models the provider lists, with what each entry states; null when it gave no listing. */
  abstract findListedModels(input: {
    provider: string;
    customKeys: Record<string, unknown>;
  }): Promise<ListedModel[] | null>;

  /** The bare model ids the provider lists; empty when it was not asked or did not answer. */
  async findServedModelIds(input: {
    provider: string;
    customKeys: Record<string, unknown>;
  }): Promise<string[]> {
    return ((await this.findListedModels(input)) ?? []).map((model) => model.id);
  }
}

/** How long one listing may take before the picker stops waiting for it. */
const LIST_BUDGET_MS = 8_000;

/** Auth shapes whose models route answers with a list; Azure and ElevenLabs have none. */
const LISTING_STRATEGIES = new Set(["bearer", "anthropic", "gemini"]);

/** Anthropic pages at 20 and Gemini at 50 by default: ask for the whole list in one page. */
const WHOLE_PAGE_PARAM: Record<string, string> = {
  anthropic: "limit=1000",
  gemini: "pageSize=1000",
};

function withWholePage(url: string, strategy: string): string {
  const param = WHOLE_PAGE_PARAM[strategy];
  if (!param) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${param}`;
}

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The ids in a models answer: OpenAI and Anthropic say `data[].id`, Gemini `models[].name`. */
export function modelIdsFromListing(body: unknown): string[] {
  const read = readModelListing(body);
  return read.kind === "listing" ? read.models.map((model) => model.id) : [];
}

type ListingTarget =
  | Readonly<{
      listable: true;
      strategy: AuthStrategy;
      apiKey: string;
      baseUrl: string;
      defaultBaseUrl: string;
      deployedBaseUrl: string;
    }>
  | Readonly<{ listable: false }>;

const NOT_LISTABLE: ListingTarget = { listable: false };

/** Where and how to ask a provider for its list, or that it cannot be asked. */
function listingTargetOf({
  provider,
  customKeys,
  deployedBaseUrls,
}: {
  provider: string;
  customKeys: Record<string, unknown>;
  deployedBaseUrls: DeployedBaseUrls;
}): ListingTarget {
  const definition = findModelProviderDefinition(provider);
  if (!definition || NOT_PROBEABLE.has(provider) || PROBE_NEEDS_MODEL.has(provider))
    return NOT_LISTABLE;
  const strategy = PROVIDER_AUTH_OVERRIDES[provider] ?? "bearer";
  if (!LISTING_STRATEGIES.has(strategy)) return NOT_LISTABLE;
  // Agent Platform has no list for a credential's project; Gemini's API door does.
  if (asString(customKeys.GEMINI_PROJECT) || provider === "google_agent_platform")
    return NOT_LISTABLE;

  const apiKey = asString(customKeys[definition.apiKey]);
  const baseUrl = definition.endpointKey ? asString(customKeys[definition.endpointKey]) : "";
  const deployedBaseUrl = deployedBaseUrls[provider]?.trim() ?? "";
  const defaultBaseUrl =
    deployedBaseUrl ||
    providerDefaultBaseUrls[provider] ||
    VALIDATION_ONLY_BASE_URLS[provider] ||
    "";
  if (apiKey === MASKED_KEY_PLACEHOLDER || (!apiKey && provider !== "custom")) return NOT_LISTABLE;
  if (!baseUrl && !defaultBaseUrl) return NOT_LISTABLE;
  return { listable: true, strategy, apiKey, baseUrl, defaultBaseUrl, deployedBaseUrl };
}

/** Lists a provider's models over the same auth shapes the credential probe proves a key with. */
export class HttpModelProviderModelListService extends ModelProviderModelList {
  static create(input: {
    egress: ModelProviderEgress;
    deployedBaseUrls?: DeployedBaseUrls;
  }): HttpModelProviderModelListService {
    return new HttpModelProviderModelListService(input.egress, input.deployedBaseUrls ?? {});
  }

  private constructor(
    private readonly egress: ModelProviderEgress,
    private readonly deployedBaseUrls: DeployedBaseUrls,
  ) {
    super();
  }

  async findListedModels(input: {
    provider: string;
    customKeys: Record<string, unknown>;
  }): Promise<ListedModel[] | null> {
    const target = listingTargetOf({ ...input, deployedBaseUrls: this.deployedBaseUrls });
    if (!target.listable) return null;
    const candidates = buildProbeCandidates({
      provider: input.provider,
      strategy: target.strategy,
      apiKey: target.apiKey,
      baseUrl: target.baseUrl,
      defaultBaseUrl: target.defaultBaseUrl,
      apiRoot: target.deployedBaseUrl ? undefined : providerApiRoots[input.provider],
    });
    const deadline = AbortSignal.timeout(LIST_BUDGET_MS);
    let emptyListing: ListedModel[] | null = null;
    for (const candidate of candidates) {
      if (deadline.aborted || (candidate.method ?? "GET") !== "GET") break;
      const url = withWholePage(candidate.url, target.strategy);
      const models = await this.#ask({ url, candidate, deadline });
      if (models && models.length > 0) return models;
      emptyListing ??= models;
    }
    return emptyListing;
  }

  async #ask({
    url,
    candidate,
    deadline,
  }: {
    url: string;
    candidate: { headers: Record<string, string> };
    deadline: AbortSignal;
  }): Promise<ListedModel[] | null> {
    try {
      const response = await this.egress.fetch(url, {
        method: "GET",
        headers: candidate.headers,
        signal: deadline,
      });
      if (!response.ok) return null;
      const read = readModelListingText(await response.text());
      return read.kind === "listing" ? read.models : null;
    } catch {
      return null;
    }
  }
}
