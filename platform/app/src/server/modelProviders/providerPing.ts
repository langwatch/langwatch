/**
 * The smallest real call a chat provider can be asked to make.
 *
 * A models listing proves a key is shaped right and reaches the vendor. It
 * does not prove the account behind it can generate anything: an OpenAI
 * account with no credit lists its models happily and refuses the first
 * completion, and a subscription-billed lane (codex) lists nothing at all
 * while working perfectly. Both read as "we could not check this" or worse as
 * a pass, which is how a customer ends up with a green row and a product that
 * quietly falls back on every AI feature.
 *
 * So Test Connection sends one generation, of one token, down the same road
 * the product uses at runtime: the nlpgo proxy for the OpenAI-compatible
 * lanes, the AI gateway for codex. What comes back is the verdict.
 *
 * Spec: specs/model-providers/connection-test.feature
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { generateText } from "ai";

import { getCodexVercelAIModel } from "./codexGatewayModel";
import {
  CODEX_PROVIDER_KEY,
  CONNECTION_TEST_FEATURE_KEY,
} from "./codexRestrictions";
import { nlpgoModelHandle } from "./modelHandle";
import {
  ProviderKeyInvalidError,
  ProviderRefusedError,
  ProviderUnreachableError,
  type ValidationResult,
} from "./providerValidation";
import type { MaybeStoredModelProvider } from "./registry";
import { getModelsForProvider, modelProviders } from "./registry";

const logger = createLogger("langwatch:api:providerPing");

/** How long one ping gets before it is reported as unreachable. */
const PING_BUDGET_MS = 20_000;

/** The prompt. Short on purpose: this is a heartbeat, not a conversation. */
const PING_PROMPT = "ping";

/** The account behind the credential cannot pay for a call. */
export class ProviderOutOfCreditError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super(
      "provider_out_of_credit",
      `${provider} reports no credit left on the account`,
      { fault: "customer", httpStatus: 402, meta: { provider } },
    );
    this.name = "ProviderOutOfCreditError";
  }
}

/** The plan behind the credential is over its allowance for now. */
export class ProviderUsageLimitError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super(
      "provider_usage_limit_reached",
      `${provider} reports the plan's usage limit was reached`,
      { fault: "customer", httpStatus: 429, meta: { provider } },
    );
    this.name = "ProviderUsageLimitError";
  }
}

/**
 * The model a ping runs.
 *
 * The cheapest chat model the catalogue lists for the provider, so a check
 * costs as close to nothing as the vendor allows; a provider the catalogue
 * does not know (a custom endpoint, a self-hosted model) is pinged with the
 * first chat model the row itself names. Null when neither has one, which is
 * the one case that reports back as unchecked.
 */
export function pingModelOf(
  modelProvider: MaybeStoredModelProvider,
): string | null {
  // A row that names its own models is asked about one of those; a row that
  // names none inherits the whole catalogue for its provider, which is what
  // the pickers show for it too.
  const named = modelProvider.models ?? [];
  const cheapest = getModelsForProvider(modelProvider.provider)
    .filter((model) => model.mode === "chat")
    .filter((model) => named.length === 0 || named.includes(model.id))
    .sort(
      (a, b) =>
        (a.pricing.inputCostPerToken ?? Number.POSITIVE_INFINITY) -
        (b.pricing.inputCostPerToken ?? Number.POSITIVE_INFINITY),
    )[0];
  if (cheapest) return cheapest.id.split("/").slice(1).join("/");
  return modelProvider.customModels?.[0]?.modelId ?? null;
}

/** The words a provider refuses with, classified. Never carried anywhere. */
function classify({
  status,
  body,
}: {
  status: number | undefined;
  body: string;
}): "credit" | "usage_limit" | "auth" | "other" {
  const text = body.toLowerCase();
  if (
    /insufficient_quota|no credits remaining|billing|exceeded your current quota|payment required/.test(
      text,
    )
  ) {
    return "credit";
  }
  if (/usage_limit_reached|usage limit|plan limit|quota exceeded/.test(text)) {
    return "usage_limit";
  }
  if (
    status === 401 ||
    status === 403 ||
    /invalid[_ ]api[_ ]key|unauthorized/.test(text)
  ) {
    return "auth";
  }
  return "other";
}

/** Whatever the SDK threw, as a status and a body, with the key taken out. */
function readFailure({ error, apiKey }: { error: unknown; apiKey: string }): {
  status: number | undefined;
  body: string;
} {
  const carrier = error as { statusCode?: unknown; responseBody?: unknown };
  const status =
    typeof carrier?.statusCode === "number" ? carrier.statusCode : undefined;
  const raw = [
    error instanceof Error ? error.message : String(error ?? ""),
    typeof carrier?.responseBody === "string" ? carrier.responseBody : "",
  ].join(" ");
  // The body is read for classification and logged, so the credential it
  // quotes back comes out first. Nothing from here reaches the customer.
  return { status, body: apiKey ? raw.split(apiKey).join("[redacted]") : raw };
}

/**
 * The verdict a failed ping gives.
 *
 * Every branch answers a different thing the reader has to do: add credit,
 * wait for the plan to roll over, replace the key, or nothing at all because
 * the provider itself is having a moment. A refusal we cannot place is the
 * provider's fault, not the customer's, so it says so rather than sending
 * them to check a key that is fine.
 */
function verdictOf({
  provider,
  error,
  apiKey,
  hasConfigurableEndpoint,
}: {
  provider: string;
  error: unknown;
  apiKey: string;
  hasConfigurableEndpoint: boolean;
}): ValidationResult {
  const { status, body } = readFailure({ error, apiKey });
  logger.info(
    { provider, status, upstreamMessage: body.slice(0, 300) },
    "provider refused a connection ping",
  );
  if (
    status === undefined &&
    /abort|timeout|fetch failed|network/i.test(body)
  ) {
    return {
      outcome: "refused",
      valid: false,
      domainError: new ProviderUnreachableError({
        provider,
        hasConfigurableEndpoint,
      }).serialize(),
    };
  }
  const refusal = {
    credit: () => new ProviderOutOfCreditError({ provider }),
    usage_limit: () => new ProviderUsageLimitError({ provider }),
    auth: () => new ProviderKeyInvalidError({ provider }),
    other: () => new ProviderRefusedError({ provider, status: status ?? 502 }),
  }[classify({ status, body })];
  return {
    outcome: "refused",
    valid: false,
    domainError: refusal().serialize(),
  };
}

/**
 * One generation against the row's own credential, or null when this row
 * cannot be pinged at all (not a chat provider, no tenant to run it in, no
 * model to name).
 *
 * Null is not a pass. The caller keeps whatever the credential probe said and
 * reports that instead, so "we could not check this" stays a distinct answer
 * from "this works".
 */
export async function pingModelProvider({
  modelProvider,
  projectId,
}: {
  modelProvider: MaybeStoredModelProvider | null;
  projectId: string | undefined;
}): Promise<ValidationResult | null> {
  if (!modelProvider || !projectId) return null;
  const provider = modelProvider.provider;
  const definition = modelProviders[provider as keyof typeof modelProviders];
  if (definition?.type !== "llm") return null;
  const model = pingModelOf(modelProvider);
  if (!model) return null;

  const customKeys = (modelProvider.customKeys ?? {}) as Record<string, string>;
  const apiKey = customKeys[definition.apiKey]?.trim() ?? "";

  try {
    const handle =
      provider === CODEX_PROVIDER_KEY
        ? await getCodexVercelAIModel({
            projectId,
            model: `${CODEX_PROVIDER_KEY}/${model}`,
            featureKey: CONNECTION_TEST_FEATURE_KEY,
          })
        : await nlpgoModelHandle({
            model: `${provider}/${model}`,
            modelProvider,
            projectId,
          });
    await generateText({
      model: handle,
      prompt: PING_PROMPT,
      maxOutputTokens: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(PING_BUDGET_MS),
    });
    return { outcome: "verified", valid: true };
  } catch (error) {
    return verdictOf({
      provider,
      error,
      apiKey,
      hasConfigurableEndpoint: !!definition.endpointKey,
    });
  }
}
