import type { RedisConnection } from "@langwatch/redis-client";

import {
  CLAIMED_VOICE_CALL_TTL_SECONDS,
  type PendingVoiceCall,
  type PendingVoiceCallAttachResult,
  type PendingVoiceCallClaimResult,
  type PendingVoiceCallPeekResult,
  type PendingVoiceCallPutResult,
  type PendingVoiceCallKey,
  type PendingVoiceCallRepository,
  type VoiceCallCancelOutcome,
} from "../pending-voice-call.repository.ts";

const KEY_PREFIX = "scenario_voice_call:v1:";

// Both keys carry the run's hash tag, so each Lua script touches one cluster slot.
const pendingKey = (scenarioRunId: string): string => `${KEY_PREFIX}{${scenarioRunId}}:pending`;
const stateKey = (scenarioRunId: string): string => `${KEY_PREFIX}{${scenarioRunId}}:state`;

// KEYS: pending, state. ARGV: call JSON, ttl.
const PUT = `
if redis.call('HGET', KEYS[2], 'state') == 'cancelled' then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('DEL', KEYS[2])
redis.call('HSET', KEYS[2], 'state', 'pending')
redis.call('EXPIRE', KEYS[2], ARGV[2])
return 1`;

// ARGV: nonce, claimed ttl. Answers {status, call JSON}.
const CLAIM = `
if redis.call('HGET', KEYS[2], 'state') == 'cancelled' then return {'cancelled'} end
local raw = redis.call('GET', KEYS[1])
if not raw or cjson.decode(raw).nonce ~= ARGV[1] then return {'unknown'} end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[2], 'state', 'claimed')
redis.call('EXPIRE', KEYS[2], ARGV[2])
return {'claimed', raw}`;

// ARGV: tombstone ttl. Answers {previous state, call SID}.
const CANCEL = `
local state = redis.call('HGET', KEYS[2], 'state') or 'absent'
local sid = redis.call('HGET', KEYS[2], 'callSid')
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[2], 'state', 'cancelled')
redis.call('EXPIRE', KEYS[2], ARGV[1])
return {state, sid or false}`;

// ARGV: call SID. Keeps the record's TTL.
const ATTACH_CALL_SID = `
local state = redis.call('HGET', KEYS[2], 'state')
if not state then return 'unknown' end
if state == 'cancelled' then return 'cancelled' end
redis.call('HSET', KEYS[2], 'callSid', ARGV[1])
return 'attached'`;

/** The fleet's pending calls in Redis; each state change is one Lua script, so one claimer wins. */
export class RedisPendingVoiceCallRepository implements PendingVoiceCallRepository {
  static create(connection: RedisConnection): RedisPendingVoiceCallRepository {
    return new RedisPendingVoiceCallRepository(connection);
  }

  private constructor(private readonly connection: RedisConnection) {}

  async put(input: {
    call: PendingVoiceCall;
    ttlSeconds: number;
  }): Promise<PendingVoiceCallPutResult> {
    const { call, ttlSeconds } = input;
    const stored = await this.connection.eval(
      PUT,
      2,
      pendingKey(call.scenarioRunId),
      stateKey(call.scenarioRunId),
      JSON.stringify(call),
      ttlSeconds,
    );
    return stored === 1
      ? ({ stored: true } as const)
      : ({ stored: false, reason: "cancelled" } as const);
  }

  async peek({ scenarioRunId, nonce }: PendingVoiceCallKey): Promise<PendingVoiceCallPeekResult> {
    const raw = await this.connection.get(pendingKey(scenarioRunId));
    const call = raw === null ? undefined : (JSON.parse(raw) as PendingVoiceCall);
    return call && call.nonce === nonce
      ? { found: true as const, call }
      : { found: false as const };
  }

  async claim({ scenarioRunId, nonce }: PendingVoiceCallKey): Promise<PendingVoiceCallClaimResult> {
    const [status, raw] = (await this.connection.eval(
      CLAIM,
      2,
      pendingKey(scenarioRunId),
      stateKey(scenarioRunId),
      nonce,
      CLAIMED_VOICE_CALL_TTL_SECONDS,
    )) as [string, string?];
    if (status === "claimed") {
      return { claimed: true, call: JSON.parse(raw!) as PendingVoiceCall } as const;
    }
    return { claimed: false, reason: status === "cancelled" ? "cancelled" : "unknown" } as const;
  }

  async cancel(input: {
    scenarioRunId: string;
    tombstoneTtlSeconds: number;
  }): Promise<VoiceCallCancelOutcome> {
    const [state, callSid] = (await this.connection.eval(
      CANCEL,
      2,
      pendingKey(input.scenarioRunId),
      stateKey(input.scenarioRunId),
      input.tombstoneTtlSeconds,
    )) as [VoiceCallCancelOutcome["state"], string | null];
    return callSid === null ? { state } : { state, callSid };
  }

  async attachCallSid(input: {
    scenarioRunId: string;
    callSid: string;
  }): Promise<PendingVoiceCallAttachResult> {
    const outcome = await this.connection.eval(
      ATTACH_CALL_SID,
      2,
      pendingKey(input.scenarioRunId),
      stateKey(input.scenarioRunId),
      input.callSid,
    );
    if (outcome === "attached") return { attached: true } as const;
    return { attached: false, reason: outcome === "cancelled" ? "cancelled" : "unknown" } as const;
  }
}
