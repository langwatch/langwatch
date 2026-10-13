import type { StoredCall, StoredResult } from "@langwatch/agent-contract";
import { z } from "zod";

/** What every pod knows about one connected instance. */
export const instanceMetaSchema = z.object({
  instanceId: z.string(),
  projectId: z.string(),
  hostname: z.string(),
  username: z.string(),
  pid: z.number(),
  sdk: z.object({
    name: z.string(),
    version: z.string(),
    language: z.string(),
  }),
  label: z.string().nullable(),
  /** The app replica that holds the socket. */
  podId: z.string(),
  connectedAt: z.number(),
  maxConcurrency: z.number(),
});
export type InstanceMeta = z.infer<typeof instanceMetaSchema>;

/** One instance's record: its meta and the agents it registered. */
export interface InstanceRecord {
  meta: InstanceMeta;
  agentIds: string[];
}

/** What the store keeps for one HTTP long-poll session, under its token. */
export const storedSessionSchema = z.object({
  principalId: z.string(),
  token: z.string(),
  instanceId: z.string(),
  projectId: z.string(),
  projectSlug: z.string(),
  agentIds: z.array(z.string()),
  meta: instanceMetaSchema,
});
export type StoredSession = z.infer<typeof storedSessionSchema>;

/** A read of one stored value: written and readable, written but unreadable, or absent. */
export type StoredLookup<T> = { kind: "hit"; value: T } | { kind: "unreadable" } | { kind: "miss" };

/** The instance a sticky thread is pinned to, if any. */
export type ThreadPinLookup = { kind: "pinned"; instanceId: string } | { kind: "unpinned" };

/**
 * The connected-agent relay's shared state across replicas (ADR-128):
 * instances and their presence, calls, results, HTTP sessions, sticky pins
 * and ownership claims. Every write carries its own expiry.
 */
export abstract class ConnectedAgentStateRepository {
  /** Writes an instance's record, replacing what was there. */
  abstract saveInstance(input: InstanceRecord & { ttlSeconds: number }): Promise<void>;

  /** Extends an instance's record, or writes `restore` when it is gone. */
  abstract extendInstance(input: {
    projectId: string;
    instanceId: string;
    restore?: InstanceRecord;
    ttlSeconds: number;
  }): Promise<void>;

  /** The instance's record; empty when it expired or was deleted. */
  abstract findInstance(input: {
    projectId: string;
    instanceId: string;
  }): Promise<InstanceRecord[]>;

  abstract deleteInstance(input: { projectId: string; instanceId: string }): Promise<void>;

  /** Records when an instance was last seen serving one agent. */
  abstract markInstanceSeen(input: {
    projectId: string;
    agentId: string;
    instanceId: string;
    seenAt: number;
    ttlSeconds: number;
  }): Promise<void>;

  /** Lowers an instance's last-seen time on one agent; never raises it, never adds it. */
  abstract lowerInstanceSeen(input: {
    projectId: string;
    agentId: string;
    instanceId: string;
    seenAt: number;
  }): Promise<void>;

  /** Forgets every instance seen at or before `cutoff`; the rest, oldest first. */
  abstract pruneSeenInstanceIds(input: {
    projectId: string;
    agentId: string;
    cutoff: number;
  }): Promise<string[]>;

  /** The calls in flight on one instance; 0 when none are counted. */
  abstract countInflight(input: { projectId: string; instanceId: string }): Promise<number>;

  abstract incrementInflight(input: {
    projectId: string;
    instanceId: string;
    ttlSeconds: number;
  }): Promise<number>;

  abstract decrementInflight(input: { projectId: string; instanceId: string }): Promise<number>;

  /** Claims an instance id for a principal; false when another principal holds it. */
  abstract claimInstanceOwner(input: {
    projectId: string;
    instanceId: string;
    principalId: string;
    ttlSeconds: number;
  }): Promise<boolean>;

  abstract saveCall(input: { call: StoredCall; ttlSeconds: number }): Promise<void>;

  abstract readCall(input: {
    projectId: string;
    callId: string;
  }): Promise<StoredLookup<StoredCall>>;

  abstract deleteCall(input: { projectId: string; callId: string }): Promise<void>;

  /** Records that the instance started the function of one call. */
  abstract markCallAcked(input: {
    projectId: string;
    callId: string;
    ttlSeconds: number;
  }): Promise<void>;

  /** Claims a call's single hand-out over HTTP; false when it was already handed out. */
  abstract claimCallDelivery(input: {
    projectId: string;
    callId: string;
    ttlSeconds: number;
  }): Promise<boolean>;

  /** Lists a call as pending on an instance until its deadline. */
  abstract addPendingCall(input: {
    projectId: string;
    instanceId: string;
    callId: string;
    deadlineAt: number;
    ttlSeconds: number;
  }): Promise<void>;

  abstract removePendingCall(input: {
    projectId: string;
    instanceId: string;
    callId: string;
  }): Promise<void>;

  /** The calls pending on an instance with a deadline at or after `from`, soonest first. */
  abstract findPendingCallIds(input: {
    projectId: string;
    instanceId: string;
    from: number;
  }): Promise<string[]>;

  abstract saveResult(input: {
    projectId: string;
    callId: string;
    result: StoredResult;
    ttlSeconds: number;
  }): Promise<void>;

  abstract readResult(input: {
    projectId: string;
    callId: string;
  }): Promise<StoredLookup<StoredResult>>;

  abstract saveHttpSession(input: { session: StoredSession; ttlSeconds: number }): Promise<void>;

  abstract readHttpSession(input: {
    projectId: string;
    token: string;
  }): Promise<StoredLookup<StoredSession>>;

  abstract deleteHttpSession(input: { projectId: string; token: string }): Promise<void>;

  abstract pinThread(input: {
    projectId: string;
    agentId: string;
    threadId: string;
    instanceId: string;
    ttlSeconds: number;
  }): Promise<void>;

  abstract readThreadPin(input: {
    projectId: string;
    agentId: string;
    threadId: string;
  }): Promise<ThreadPinLookup>;
}
