// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createHash } from "node:crypto";

import type {
  RecordVkLifecycleCommandData,
  VirtualKeyPurpose,
  VkLifecycleAction,
} from "@langwatch/gateway-contract";

/** What one gateway lifecycle fact tells nurturing's copy of its key; times are epoch ms. */
export type NurturingVirtualKeyFact = Readonly<{
  virtualKeyId: string;
  organizationId: string;
  action: VkLifecycleAction;
  name: string;
  /** The person who made the change; null when no person did. */
  actorUserId: string | null;
  principalUserId: string | null;
  purpose: VirtualKeyPurpose | null;
  occurredAt: number;
}>;

/**
 * Nurturing's copy of one gateway key (`NurturingVirtualKey`). The name is the latest fact's; the
 * creator is the created fact's alone; the holder and purpose are each the latest non-null value,
 * stamped with its fact's time, and no holder when that names an erased person; each state time
 * is its latest. Times are epoch ms, null unseen.
 */
export type NurturingVirtualKey = Readonly<{
  virtualKeyId: string;
  organizationId: string;
  name: string;
  occurredAt: number;
  keyCreatedAt: number | null;
  creatorUserId: string | null;
  principalUserId: string | null;
  principalUserIdAt: number | null;
  purpose: VirtualKeyPurpose | null;
  purposeAt: number | null;
  disabledAt: number | null;
  enabledAt: number | null;
  revokedAt: number | null;
}>;

/** Gateway's fact as the copy takes it; a fact stored before a field was recorded reads null. */
export function virtualKeyFactOf(data: RecordVkLifecycleCommandData): NurturingVirtualKeyFact {
  return {
    virtualKeyId: data.virtual_key_id,
    organizationId: data.organization_id,
    action: data.action,
    name: data.name,
    actorUserId: data.actor_user_id ?? null,
    principalUserId: data.principal_user_id ?? null,
    purpose: data.purpose ?? null,
    occurredAt: data.occurred_at,
  };
}

type Stamped<Value> = Readonly<{ value: Value | null; at: number | null }>;

/**
 * The later of two stamped values; a null value never replaces one, and a tie keeps the held
 * unless it is null: a holder cleared for an erased person is filled by another fact at its stamp,
 * so once a person is marked, their fact and another's at one stamp fold the same in either order.
 */
function laterNonNull<Value>(held: Stamped<Value>, incoming: Stamped<Value>): Stamped<Value> {
  if (incoming.value === null || incoming.at === null) return held;
  if (held.at === null || incoming.at > held.at) return incoming;
  return held.value === null && incoming.at === held.at ? incoming : held;
}

type StateTime = Readonly<{
  held: number | null;
  fact: NurturingVirtualKeyFact;
  action: VkLifecycleAction;
}>;

/** The latest of a held time and this fact's, when the fact is that action. */
function foldStateTime({ held, fact, action }: StateTime): number | null {
  if (fact.action !== action) return held;
  return held === null ? fact.occurredAt : Math.max(held, fact.occurredAt);
}

/** A key no fact named yet, so the first fact folds in like any other. */
function unseenKey(fact: NurturingVirtualKeyFact): NurturingVirtualKey {
  return {
    virtualKeyId: fact.virtualKeyId,
    organizationId: fact.organizationId,
    name: fact.name,
    occurredAt: fact.occurredAt,
    keyCreatedAt: null,
    creatorUserId: null,
    principalUserId: null,
    principalUserIdAt: null,
    purpose: null,
    purposeAt: null,
    disabledAt: null,
    enabledAt: null,
    revokedAt: null,
  };
}

type KeyFold = Readonly<{ held: NurturingVirtualKey | null; fact: NurturingVirtualKeyFact }>;

/**
 * One lifecycle fact folded into the key's copy. Every column folds order-free, so a redelivered
 * or late fact leaves the copy as it was; the Postgres twin writes the same rule in one statement.
 */
export function foldVirtualKeyFact({ held, fact }: KeyFold): NurturingVirtualKey {
  const known = held ?? unseenKey(fact);
  const at = fact.occurredAt;
  const firstCreated = known.keyCreatedAt === null && fact.action === "created";
  const principal = laterNonNull(
    { value: known.principalUserId, at: known.principalUserIdAt },
    { value: fact.principalUserId, at },
  );
  const purpose = laterNonNull(
    { value: known.purpose, at: known.purposeAt },
    { value: fact.purpose, at },
  );
  return {
    ...known,
    name: at >= known.occurredAt ? fact.name : known.name,
    occurredAt: Math.max(known.occurredAt, at),
    keyCreatedAt: firstCreated ? at : known.keyCreatedAt,
    creatorUserId: firstCreated ? fact.actorUserId : known.creatorUserId,
    principalUserId: principal.value,
    principalUserIdAt: principal.at,
    purpose: purpose.value,
    purposeAt: purpose.at,
    disabledAt: foldStateTime({ held: known.disabledAt, fact, action: "disabled" }),
    enabledAt: foldStateTime({ held: known.enabledAt, fact, action: "enabled" }),
    revokedAt: foldStateTime({ held: known.revokedAt, fact, action: "revoked" }),
  };
}

/**
 * An erased account taken out of a key's copy: neither its creator nor its holder any more. A
 * cleared holder keeps their stamp, so the key reads as `foldVirtualKeyFactWithoutErased` leaves
 * it: no holder at the stamp of the fact that named them, which an older fact cannot fill and a
 * later one naming someone else can.
 */
export function forgetPersonOnKey({
  key,
  userId,
}: Readonly<{ key: NurturingVirtualKey; userId: string }>): NurturingVirtualKey {
  return {
    ...key,
    creatorUserId: key.creatorUserId === userId ? null : key.creatorUserId,
    principalUserId: key.principalUserId === userId ? null : key.principalUserId,
  };
}

/**
 * How nurturing marks an account erased: a SHA-256 of its id, so the mark holds no id. The domain
 * prefix keeps it from matching the bare SHA-256 a delivery claim key carries for the same id.
 */
export function erasedUserHashOf(userId: string): string {
  return createHash("sha256").update(`nurturing-erased-user:${userId}`).digest("hex");
}

/**
 * One fact folded in with the erased people it names taken out of the roles it names them in, as
 * the Postgres upsert and its re-check do: an erased holder it names leaves the key with no holder,
 * stamped with the fact when it is the latest, so the key ends as when the fact landed before the
 * erasure; an erased creator a created fact names is stored as none. A fact can land after the
 * erasure on any key, copied or not.
 */
export function foldVirtualKeyFactWithoutErased({
  held,
  fact,
  isErased,
}: Readonly<{
  held: NurturingVirtualKey | null;
  fact: NurturingVirtualKeyFact;
  isErased: (userId: string) => boolean;
}>): NurturingVirtualKey {
  const key = foldVirtualKeyFact({ held, fact });
  const clears = (named: string | null, stored: string | null) =>
    named !== null && stored === named && isErased(named);
  const creator = fact.action === "created" ? fact.actorUserId : null;
  return {
    ...key,
    creatorUserId: clears(creator, key.creatorUserId) ? null : key.creatorUserId,
    principalUserId: clears(fact.principalUserId, key.principalUserId) ? null : key.principalUserId,
  };
}

/** Only a USER key has a person behind it; a fact stored before purpose was recorded is USER. */
export function isPersonKey(purpose: VirtualKeyPurpose | null): boolean {
  return (purpose ?? "USER") === "USER";
}

/** Not revoked, and not disabled unless enabled again since. */
export function isLiveKey(key: NurturingVirtualKey): boolean {
  if (key.revokedAt !== null) return false;
  return key.disabledAt === null || (key.enabledAt !== null && key.enabledAt > key.disabledAt);
}
