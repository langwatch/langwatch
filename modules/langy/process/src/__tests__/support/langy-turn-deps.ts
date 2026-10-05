import type { LangyWorkerCredentials } from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";

import { MemoryLangyRepositories } from "../../repositories/memory/memory.langy.repositories.ts";
import type { ConversationDetail } from "../../rules/langy-conversation-shape.rules.ts";
import type {
  LangyTurnServiceDependencies,
  LangyTurnServiceDeps,
} from "../../services/langy-turn-shared.service.ts";

type Slot<T> = T extends object ? Partial<T> : T;

/**
 * Each member stubbed by name; an absent one throws when the turn reaches it,
 * except the live-edge rows, which default to the memory tier's.
 */
export type LangyTurnDepsOverrides = {
  [K in keyof LangyTurnServiceDependencies]?: Slot<LangyTurnServiceDependencies[K]>;
};

function nullable<T extends object>(value: Partial<T> | null | undefined, name: string): T | null {
  return value ? createApiFixture<T>(value, name) : null;
}

function optional<T extends object>(value: Partial<T> | undefined, name: string): T | undefined {
  return value ? createApiFixture<T>(value, name) : undefined;
}

export function langyTurnDeps(over: LangyTurnDepsOverrides = {}): LangyTurnServiceDeps {
  const rows = MemoryLangyRepositories.create();
  return {
    finalParts: optional(over.finalParts, "finalParts"),
    conversations: createApiFixture(over.conversations, "conversations"),
    credentials: createApiFixture(over.credentials, "credentials"),
    prompts: optional(over.prompts, "prompts"),
    promptProjectId: over.promptProjectId,
    models: createApiFixture(over.models, "models"),
    worker: nullable(over.worker, "worker"),
    tokenBuffer: over.tokenBuffer
      ? createApiFixture(over.tokenBuffer, "tokenBuffer")
      : rows.tokenBuffer.open(),
    permits: createApiFixture(over.permits, "permits"),
    harness: optional(over.harness, "harness"),
    perDayPrCap: over.perDayPrCap ?? 0,
    sessionKeys: createApiFixture(over.sessionKeys, "sessionKeys"),
    context: createApiFixture(over.context, "context"),
    uiActionSurface: createApiFixture(over.uiActionSurface, "uiActionSurface"),
    skillGates: createApiFixture(
      over.skillGates ?? { resolveDisabled: async () => [] },
      "skillGates",
    ),
    metrics: createApiFixture(over.metrics, "metrics"),
    admission: createApiFixture(over.admission, "admission"),
    accessStore: over.accessStore
      ? createApiFixture(over.accessStore, "accessStore")
      : rows.turnAccess,
    handoffStore: over.handoffStore
      ? createApiFixture(over.handoffStore, "handoffStore")
      : rows.turnHandoff,
    messages: nullable(over.messages, "messages"),
  };
}

export function langyTurnDependencies(
  over: LangyTurnDepsOverrides & { finalParts: LangyTurnServiceDependencies["finalParts"] },
): LangyTurnServiceDependencies {
  return { ...langyTurnDeps(over), finalParts: over.finalParts };
}

export function workerCredentials(
  over: Partial<LangyWorkerCredentials> = {},
): LangyWorkerCredentials {
  return {
    llmVirtualKey: "vk",
    langwatchEndpoint: "http://langwatch.test",
    gatewayBaseUrl: "http://gateway.test",
    organizationId: "organization-1",
    ...over,
  };
}

export function conversationDetail(over: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    id: "conversation-1",
    title: null,
    isShared: false,
    isOwn: true,
    lastActivityAt: Temporal.Instant.fromEpochMilliseconds(0),
    messageCount: 0,
    status: "idle",
    currentTurnId: null,
    lastError: null,
    lastModel: null,
    eventCursor: null,
    ...over,
  };
}
