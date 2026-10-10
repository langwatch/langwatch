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
 * Spec: specs/model-providers/credential-validation.feature
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
  type UncheckedReason,
  type ValidationResult,
} from "./providerValidation";
import type { MaybeStoredModelProvider } from "./registry";
import { getModelsForProvider, modelProviders } from "./registry";

const logger = createLogger("langwatch:api:providerPing");

/** How long one ping gets before it is reported as unreachable. */
const PING_BUDGET_MS = 20_000;

/** The prompt. Short on purpose: this is a heartbeat, not a conversation. */
const PING_PROMPT = "ping";

/**
 * The credential-probe outcomes a ping must not run after.
 *
 * Both mean the row's own credential could not be read, and the runtime falls
 * back to the host environment key for a row that carries none. A generation
 * would then answer for a credential this row does not hold and report the
 * row as working, which is the exact confusion the third verdict exists to
 * prevent.
 */
export const UNPINGABLE_CREDENTIALS: readonly UncheckedReason[] = [
  "no_credential",
  "credential_masked",
];

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

/** A catalogue id without its provider prefix, the way a row spells it. */
function bareModelId(id: string): string {
  return id.split("/").slice(1).join("/");
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
  //
  // The two sides spell a model differently: the catalogue keys it
  // `openai/gpt-5-mini`, a row keys it `gpt-5-mini`, because the lists a row
  // is filled from (`getProviderModelOptions`, and the picker behind it) drop
  // the provider prefix. Both spellings are accepted so a row written either
  // way still names a model.
  const named = modelProvider.models ?? [];
  const cheapest = getModelsForProvider(modelProvider.provider)
    .filter((model) => model.mode === "chat")
    .filter(
      (model) =>
        named.length === 0 ||
        named.includes(bareModelId(model.id)) ||
        named.includes(model.id),
    )
    .sort(
      (a, b) =>
        (a.pricing.inputCostPerToken ?? Number.POSITIVE_INFINITY) -
        (b.pricing.inputCostPerToken ?? Number.POSITIVE_INFINITY),
    )[0];
  if (cheapest) return bareModelId(cheapest.id);
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

/**
 * Whatever the SDK threw, as a status and a body.
 *
 * The body stays in this module: it is read to classify the refusal and
 * nothing more. It is the provider's own prose, and an OpenAI 401 answers
 * with `Incorrect API key provided: sk-…`, so neither the log line nor the
 * customer ever sees it. What travels is the status and the class.
 */
function readFailure(error: unknown): {
  status: number | undefined;
  body: string;
  hasAnswered: boolean;
} {
  const carrier = error as { statusCode?: unknown; responseBody?: unknown };
  const status =
    typeof carrier?.statusCode === "number" ? carrier.statusCode : undefined;
  const responseBody =
    typeof carrier?.responseBody === "string" ? carrier.responseBody : "";
  const body = [
    error instanceof Error ? error.message : String(error ?? ""),
    responseBody,
  ].join(" ");
  // Something that answered has a status line, a body, or both. A failure
  // carrying neither never got that far, whatever words the SDK wrapped it
  // in.
  return {
    status,
    body,
    hasAnswered: status !== undefined || responseBody !== "",
  };
}

/**
 * The cause, in the log message itself.
 *
 * The log collector ships the `msg` field and drops everything beside it, so
 * a cause carried only in structured fields never leaves the cluster. What
 * goes in is the provider, the class of refusal, the HTTP status and the name
 * the SDK threw under. The provider's own prose stays out: it is the one part
 * of a refusal that can carry a key fragment.
 */
function describeRefusal({
  provider,
  error,
  status,
  classified,
}: {
  provider: string;
  error: unknown;
  status: number | undefined;
  classified: string;
}): string {
  const name = error instanceof Error && error.name ? error.name : typeof error;
  return [
    `provider ${provider}`,
    `as ${classified}`,
    status === undefined ? "no HTTP status" : `HTTP ${status}`,
    `thrown as ${name}`,
  ].join(", ");
}

/**
 * The verdict a failed ping gives.
 *
 * Every branch answers a different thing the reader has to do: add credit,
 * wait for the plan to roll over, replace the key, or nothing at all because
 * the provider itself is having a moment. A refusal we cannot place is the
 * provider's fault, not the customer's, so it says so rather than sending
 * them to check a key that is fine.
 *
 * A failure that never reached the provider is not a refusal at all, and the
 * two must not be confused: "it answered and would not confirm the key" is
 * the wrong thing to read when the address was never opened. What separates
 * them is whether anything came back, not the words the SDK wrapped the
 * failure in, which differ per transport (`Cannot connect to API` from the
 * AI SDK, `fetch failed` from undici).
 */
function verdictOf({
  provider,
  error,
  hasConfigurableEndpoint,
}: {
  provider: string;
  error: unknown;
  hasConfigurableEndpoint: boolean;
}): ValidationResult {
  const { status, body, hasAnswered } = readFailure(error);
  const classified = hasAnswered
    ? classify({ status, body })
    : ("unreachable" as const);
  logger.info(
    { provider, status, classifiedAs: classified },
    `Connection ping refused (${describeRefusal({ provider, error, status, classified })})`,
  );
  if (classified === "unreachable") {
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
  }[classified];
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
      hasConfigurableEndpoint: !!definition.endpointKey,
    });
  }
}
