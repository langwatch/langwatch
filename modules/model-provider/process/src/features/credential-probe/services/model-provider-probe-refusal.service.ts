import { type HandledError, type SerializedHandledError } from "@langwatch/handled-error";
import { ProviderKeyInvalidError, ProviderRefusedError } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

import {
  GEMINI_REASON_ERRORS,
  MAX_UPSTREAM_DETAIL_LENGTH,
  type UpstreamRefusal,
  extractUpstreamMessage,
  extractUpstreamReason,
  redactApiKey,
} from "../../../rules/model-provider-probe-upstream.rules.ts";
import type { ProbeContext } from "./model-provider-probe-chain.service.ts";
import type { ModelProviderEgressResponse } from "./ssrf-model-provider-egress.service.ts";

/**
 * The response shape the probe actually receives.
 */
export type ProbeResponse = ModelProviderEgressResponse;

const logger = createLogger("langwatch:api:providerValidation");

/**
 * Reads the provider's own explanation for a refusal. Never throws: an
 * unreadable body just means we fall back to the generic message.
 */
async function readUpstreamRefusal(
  response: ProbeResponse,
  apiKey: string,
): Promise<UpstreamRefusal> {
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    return {};
  }

  if (!raw?.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  const message = extractUpstreamMessage(parsed);

  return {
    message: message
      ? redactApiKey(message, apiKey).slice(0, MAX_UPSTREAM_DETAIL_LENGTH)
      : undefined,
    reason: extractUpstreamReason(parsed),
  };
}

/**
 * Google's verdict on the key itself, when it gave one.
 */
function classifyGeminiRefusal({
  provider,
  reason,
  googleDoor,
}: {
  provider: string;
  reason: string | undefined;
  googleDoor?: "gemini-api" | "agent-platform";
}): RankedFailure | undefined {
  // Both Google providers speak the same ErrorInfo shape — the legacy
  // fold-window provider probes the Agent Platform door and its refusals
  // carry the same enumerated reasons.
  if (provider !== "gemini" && provider !== "google_agent_platform") {
    return undefined;
  }
  if (!reason) return undefined;

  const build = GEMINI_REASON_ERRORS[reason];
  if (!build) return undefined;

  const error = build({ provider, googleDoor });

  return refusal(
    error,
    // Only a reason naming something else is worth outranking the provider's
    // own verdict that the key itself is wrong.
    error.code === "provider_key_invalid" ? FAILURE_RANK.definitive : FAILURE_RANK.actionable,
  );
}

/** A refusal, ranked by how much it tells the customer. */
export function refusal(error: HandledError, rank: number): RankedFailure {
  return { valid: false, domainError: error.serialize(), rank };
}

/**
 * @param response - The fetch Response object
 * @param context - Which provider was probed, and with which key
 * @returns The refusal, ranked
 */
export async function handleHttpError({
  response,
  context,
}: {
  response: ProbeResponse;
  context: ProbeContext;
}): Promise<RankedFailure> {
  const { message, reason } = await readUpstreamRefusal(response, context.apiKey);

  // The one place the provider's own words are kept. Redacted at the point of
  // reading, because this is a log and the key is what it would otherwise
  // quote back; the customer never sees this line either way.
  logger.info(
    {
      provider: context.provider,
      status: response.status,
      reason,
      upstreamMessage: message,
    },
    "provider refused a credential check",
  );

  const fromReason = classifyGeminiRefusal({
    provider: context.provider,
    reason,
    googleDoor: context.googleDoor,
  });
  if (fromReason) return fromReason;

  // The Gemini API reports a rejected key as 400, every other provider —
  // including Gemini's own Agent Platform door, where 400 is a malformed
  // request — as 401/403.
  const isAuthFailure =
    response.status === 401 ||
    response.status === 403 ||
    (context.provider === "gemini" &&
      context.googleDoor !== "agent-platform" &&
      response.status === 400);

  if (isAuthFailure) {
    return refusal(
      new ProviderKeyInvalidError({ provider: context.provider }),
      message ? FAILURE_RANK.explained : FAILURE_RANK.generic,
    );
  }

  return refusal(
    new ProviderRefusedError({
      provider: context.provider,
      status: response.status,
    }),
    FAILURE_RANK.explained,
  );
}

/**
 * How useful a refusal is to the customer, lowest first.
 */
export const FAILURE_RANK = {
  /** A mapped reason naming something the customer can change. */
  actionable: 0,
  /** The provider positively identified the key as invalid. */
  definitive: 1,
  /** An auth failure carrying the provider's own explanation. */
  explained: 2,
  /** An auth failure with nothing to add. */
  generic: 3,
  /** We never got an answer, so this says nothing about the key. */
  unreachable: 4,
} as const;

export type RankedFailure = {
  valid: false;
  domainError: SerializedHandledError;
  rank: number;
};

/**
 * Picks the refusal worth showing, keeping the first of equally useful ones.
 */
export function pickMostInformativeFailure(failures: RankedFailure[]): RankedFailure | undefined {
  return failures.reduce<RankedFailure | undefined>(
    (chosen, failure) => (!chosen || failure.rank < chosen.rank ? failure : chosen),
    undefined,
  );
}
