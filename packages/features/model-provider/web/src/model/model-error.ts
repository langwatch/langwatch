/**
 * Reading a model-resolution refusal off a failed call. All three shapes travel
 * on the serialised `data.cause` sidecar, read structurally rather than through
 * the transport's own class — the way the host's `isNotFoundError` does.
 */

import { markHandledGlobally } from "@langwatch/ui-host/errors";

/** Every role a feature key can resolve a model for. */
export type ModelErrorRole = "DEFAULT" | "FAST" | "LANGY" | "EMBEDDINGS";

const MODEL_ERROR_ROLES: readonly string[] = ["DEFAULT", "FAST", "LANGY", "EMBEDDINGS"];

/** The wire sidecar, as much of it as any of the three readers below names. */
type SerializedModelCause = {
  code?: string;
  featureKey?: string;
  featureDisplayName?: string;
  role?: string;
  projectId?: string;
  resolvedScope?: string;
  resolvedModel?: string;
  providerKey?: string;
  alternate?: ProviderDisabledExtracted["alternate"];
};

function causeOf(error: unknown): SerializedModelCause | undefined {
  if (!(error instanceof Error)) return undefined;
  const data = (error as { data?: { cause?: unknown } }).data;
  const cause = data?.cause;
  return typeof cause === "object" && cause !== null ? (cause as SerializedModelCause) : undefined;
}

function readRole(role: string | undefined): ModelErrorRole | null {
  return role !== undefined && MODEL_ERROR_ROLES.includes(role) ? (role as ModelErrorRole) : null;
}

// --- Missing-model (ModelNotConfiguredError) dedup ---
const handledMissingModelErrors = new WeakSet<Error>();

export function markAsHandledByMissingModelHandler(error: Error): void {
  handledMissingModelErrors.add(error);
  markHandledGlobally(error);
}

export function isHandledByMissingModelHandler(error: unknown): boolean {
  return error instanceof Error && handledMissingModelErrors.has(error);
}

export interface MissingModelExtracted {
  featureKey: string;
  featureDisplayName: string;
  role: ModelErrorRole;
  projectId?: string;
}

/**
 * The payload of a `MODEL_NOT_CONFIGURED` refusal, whose wire shape the server's
 * `ModelNotConfiguredError` sets. Keying off the cause rather than the
 * transport's code is what funnels REST and tRPC into one toast.
 */
export function extractMissingModelInfo(error: unknown): MissingModelExtracted | null {
  const cause = causeOf(error);
  if (cause?.code !== "MODEL_NOT_CONFIGURED") return null;
  if (!cause.featureKey) return null;

  const role = readRole(cause.role);
  if (!role) return null;

  return {
    featureKey: cause.featureKey,
    featureDisplayName: cause.featureDisplayName ?? cause.featureKey,
    role,
    projectId: cause.projectId,
  };
}

// --- Provider-disabled (ModelProviderDisabledError) dedup ---
const handledProviderDisabledErrors = new WeakSet<Error>();

export function markAsHandledByProviderDisabledHandler(error: Error): void {
  handledProviderDisabledErrors.add(error);
  markHandledGlobally(error);
}

export function isHandledByProviderDisabledHandler(error: unknown): boolean {
  return error instanceof Error && handledProviderDisabledErrors.has(error);
}

export interface ProviderDisabledExtracted {
  featureKey: string;
  featureDisplayName: string;
  role: ModelErrorRole;
  projectId: string;
  resolvedScope: "project" | "team" | "organization";
  resolvedModel: string;
  providerKey: string;
  alternate: {
    scope: "team" | "organization";
    model: string;
    providerKey: string;
    providerEnabled: boolean;
  } | null;
}

/**
 * Extracts the typed payload from an error whose cause is
 * `MODEL_PROVIDER_DISABLED`. The wire shape is set by the server-side
 * `ModelProviderDisabledError`.
 */
export function extractProviderDisabledInfo(error: unknown): ProviderDisabledExtracted | null {
  const cause = causeOf(error);
  if (cause?.code !== "MODEL_PROVIDER_DISABLED") return null;
  if (
    !cause.featureKey ||
    !cause.projectId ||
    !cause.resolvedScope ||
    !cause.resolvedModel ||
    !cause.providerKey
  ) {
    return null;
  }

  const role = readRole(cause.role);
  if (!role) return null;

  const resolvedScope = cause.resolvedScope as ProviderDisabledExtracted["resolvedScope"];
  if (resolvedScope !== "project" && resolvedScope !== "team" && resolvedScope !== "organization") {
    return null;
  }

  return {
    featureKey: cause.featureKey,
    featureDisplayName: cause.featureDisplayName ?? cause.featureKey,
    role,
    projectId: cause.projectId,
    resolvedScope,
    resolvedModel: cause.resolvedModel,
    providerKey: cause.providerKey,
    alternate: cause.alternate ?? null,
  };
}

/**
 * Wire-side discriminator a server route attaches when a downstream AI call
 * fails for a non-MODEL_NOT_CONFIGURED reason (provider 5xx, 401 on a stale
 * key, malformed custom model id).
 */
export const AI_CALL_FAILED_CAUSE = "AI_CALL_FAILED" as const;

export interface AiCallFailedExtracted {
  featureKey: string;
  featureDisplayName: string;
  role: ModelErrorRole;
}

export function extractAiCallFailedInfo(error: unknown): AiCallFailedExtracted | null {
  const cause = causeOf(error);
  if (cause?.code !== AI_CALL_FAILED_CAUSE) return null;
  if (!cause.featureKey) return null;

  const role = readRole(cause.role);
  if (!role) return null;

  return {
    featureKey: cause.featureKey,
    featureDisplayName: cause.featureDisplayName ?? cause.featureKey,
    role,
  };
}
