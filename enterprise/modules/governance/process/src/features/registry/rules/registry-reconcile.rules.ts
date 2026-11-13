// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createHash } from "node:crypto";

import type {
  AgentRegistryEntry,
  AgentRegistryEvent,
  AgentRegistryEventType,
  AgentRegistryTool,
} from "@langwatch/enterprise-governance-contract";
import { Temporal, type Instant } from "@langwatch/time";

import type { RegistryDraft } from "./registry-entry.rules.ts";

/** One registry row as the repository holds it. */
export type StoredRegistryEntry = {
  id: string;
  sourceKey: string;
  fingerprint: string;
  entry: AgentRegistryEntry;
};

/** A row to write: the entry as it now stands. */
type RegistryEntryWrite = {
  id: string;
  sourceKey: string;
  fingerprint: string;
  entry: AgentRegistryEntry;
  isNew: boolean;
};

/** A change fact to append; the repository gives it its feed sequence. */
type RegistryEventDraft = {
  id: string;
  type: AgentRegistryEventType;
  entryId: string;
  fromVersion: number | null;
  toVersion: number | null;
  tool: string | null;
  occurredAt: Instant;
  agent: AgentRegistryEntry;
};

export type RegistryChangeSet = { writes: RegistryEntryWrite[]; events: RegistryEventDraft[] };

/** Millisecond ISO-8601, the precision Postgres keeps, so cursors and filters compare exactly. */
export function registryTimestamp(instant: Instant): string {
  return Temporal.Instant.fromEpochMilliseconds(instant.epochMilliseconds).toString({
    fractionalSecondDigits: 3,
  });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** What makes a version: everything but the registry's own dates and counters. */
function registryFingerprint(entry: AgentRegistryEntry): string {
  const {
    id: _id,
    version: _version,
    first_seen_at: _firstSeen,
    last_seen_at: _lastSeen,
    updated_at: _updated,
    removed_at: _removed,
    ...material
  } = entry;
  return createHash("sha256")
    .update(JSON.stringify(canonical(material)))
    .digest("hex");
}

/** The draft's tools active; a tool the last version had and this one lacks stays, deprecated. */
function mergeTools({
  previous,
  current,
  version,
  now,
}: {
  previous: readonly AgentRegistryTool[];
  current: RegistryDraft["tools"];
  version: number;
  now: Instant;
}): { tools: AgentRegistryTool[]; newlyDeprecated: string[] } {
  const currentNames = new Set(current.map((tool) => tool.name));
  const tools: AgentRegistryTool[] = current.map((tool) => ({
    ...tool,
    status: "active",
    deprecated_in_version: null,
    deprecated_at: null,
  }));
  const newlyDeprecated: string[] = [];
  for (const tool of previous) {
    if (currentNames.has(tool.name)) continue;
    if (tool.status === "deprecated") {
      tools.push(tool);
      continue;
    }
    newlyDeprecated.push(tool.name);
    tools.push({
      ...tool,
      status: "deprecated",
      deprecated_in_version: version,
      deprecated_at: registryTimestamp(now),
    });
  }
  return { tools, newlyDeprecated };
}

function entryOf({
  id,
  draft,
  version,
  tools,
  firstSeenAt,
  updatedAt,
}: {
  id: string;
  draft: RegistryDraft;
  version: number;
  tools: AgentRegistryTool[];
  firstSeenAt: string;
  updatedAt: string;
}): AgentRegistryEntry {
  const { sourceKey: _sourceKey, firstSeenAt: _first, lastSeenAt, ...described } = draft;
  return {
    ...described,
    id,
    status: "active",
    version,
    tools,
    first_seen_at: firstSeenAt,
    last_seen_at: lastSeenAt ? registryTimestamp(lastSeenAt) : null,
    updated_at: updatedAt,
    removed_at: null,
  };
}

function event(
  input: Omit<RegistryEventDraft, "id" | "occurredAt" | "tool"> & { tool?: string },
  { newId, now }: Pick<PlanContext, "newId" | "now">,
): RegistryEventDraft {
  return { ...input, id: newId(), occurredAt: now, tool: input.tool ?? null };
}

type PlanContext = { newId: () => string; now: Instant; at: string };

/** A draft the registry does not hold: version 1, flagged at once when it is shadow. */
function planRegistered(draft: RegistryDraft, context: PlanContext): RegistryChangeSet {
  const id = context.newId();
  const { tools } = mergeTools({
    previous: [],
    current: draft.tools,
    version: 1,
    now: context.now,
  });
  const entry = entryOf({
    id,
    draft,
    version: 1,
    tools,
    firstSeenAt: registryTimestamp(draft.firstSeenAt),
    updatedAt: context.at,
  });
  const facts = { entryId: id, fromVersion: null, toVersion: 1, agent: entry } as const;
  const events = [event({ ...facts, type: "governance.agent.registered" }, context)];
  if (entry.shadow)
    events.push(event({ ...facts, type: "governance.agent.flagged_shadow" }, context));
  const write = { id, sourceKey: draft.sourceKey, fingerprint: registryFingerprint(entry), entry };
  return { writes: [{ ...write, isNew: true }], events };
}

/** A held agent observed again: a new version on a material change, else at most a last-seen move. */
function planObserved(
  draft: RegistryDraft,
  held: StoredRegistryEntry,
  context: PlanContext,
): RegistryChangeSet {
  const previous = held.entry;
  const nextVersion = previous.version + 1;
  const merged = mergeTools({
    previous: previous.tools,
    current: draft.tools,
    version: nextVersion,
    now: context.now,
  });
  const candidate = entryOf({
    id: held.id,
    draft,
    version: nextVersion,
    tools: merged.tools,
    firstSeenAt: previous.first_seen_at,
    updatedAt: context.at,
  });
  const fingerprint = registryFingerprint(candidate);
  const row = { id: held.id, sourceKey: held.sourceKey, fingerprint, isNew: false };

  if (fingerprint === held.fingerprint && previous.status === "active") {
    if (candidate.last_seen_at === previous.last_seen_at) return { writes: [], events: [] };
    const entry = { ...previous, last_seen_at: candidate.last_seen_at };
    return { writes: [{ ...row, entry }], events: [] };
  }

  const facts = {
    entryId: held.id,
    fromVersion: previous.version,
    toVersion: nextVersion,
    agent: candidate,
  };
  const events = [event({ ...facts, type: "governance.agent.versioned" }, context)];
  if (candidate.shadow && !previous.shadow) {
    events.push(event({ ...facts, type: "governance.agent.flagged_shadow" }, context));
  }
  for (const tool of merged.newlyDeprecated) {
    events.push(event({ ...facts, type: "governance.agent.tool_deprecated", tool }, context));
  }
  return { writes: [{ ...row, entry: candidate }], events };
}

/** A held agent no draft names any more: one removal, never a deletion. */
function planRemoved(held: StoredRegistryEntry, context: PlanContext): RegistryChangeSet {
  if (held.entry.status === "removed") return { writes: [], events: [] };
  const version = held.entry.version + 1;
  const entry: AgentRegistryEntry = {
    ...held.entry,
    status: "removed",
    version,
    updated_at: context.at,
    removed_at: context.at,
  };
  const fingerprint = registryFingerprint(entry);
  return {
    writes: [{ id: held.id, sourceKey: held.sourceKey, fingerprint, entry, isNew: false }],
    events: [
      event(
        {
          type: "governance.agent.removed",
          entryId: held.id,
          fromVersion: held.entry.version,
          toVersion: version,
          agent: entry,
        },
        context,
      ),
    ],
  };
}

/**
 * What the registry must write and announce for drafts observed now against what it holds. A
 * held agent no draft names is removed; a removed one that returns is versioned back to active.
 * A last-seen move alone rewrites the row and announces nothing. Spec: specs/agent-registry.feature
 */
export function planRegistryChanges({
  stored,
  drafts,
  now,
  newId,
}: {
  stored: readonly StoredRegistryEntry[];
  drafts: readonly RegistryDraft[];
  now: Instant;
  newId: () => string;
}): RegistryChangeSet {
  const context: PlanContext = { newId, now, at: registryTimestamp(now) };
  const bySourceKey = new Map(stored.map((row) => [row.sourceKey, row]));
  const plans = drafts.map((draft) => {
    const held = bySourceKey.get(draft.sourceKey);
    bySourceKey.delete(draft.sourceKey);
    return held ? planObserved(draft, held, context) : planRegistered(draft, context);
  });
  plans.push(...[...bySourceKey.values()].map((held) => planRemoved(held, context)));
  return {
    writes: plans.flatMap((plan) => plan.writes),
    events: plans.flatMap((plan) => plan.events),
  };
}

/** An appended draft as the feed publishes it, once the repository gave it its sequence. */
export function registryEventOf({
  organizationId,
  sequence,
  draft,
}: {
  organizationId: string;
  sequence: bigint;
  draft: Pick<
    RegistryEventDraft,
    "id" | "type" | "entryId" | "fromVersion" | "toVersion" | "tool" | "agent"
  > & { occurredAt: string };
}): AgentRegistryEvent {
  return {
    id: draft.id,
    sequence: sequence.toString(),
    type: draft.type,
    organization_id: organizationId,
    agent_id: draft.entryId,
    from_version: draft.fromVersion,
    to_version: draft.toVersion,
    tool: draft.tool,
    occurred_at: draft.occurredAt,
    agent: draft.agent,
  };
}
