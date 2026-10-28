import {
  VOICE_CALL_RECORD_TTL_SECONDS,
  type PendingVoiceCall,
  type PendingVoiceCallAttachResult,
  type PendingVoiceCallClaimResult,
  type PendingVoiceCallPeekResult,
  type PendingVoiceCallPutResult,
  type PendingVoiceCallKey,
  type PendingVoiceCallRepository,
  type VoiceCallCancelOutcome,
} from "../pending-voice-call.repository.ts";

type RunRecord = {
  state: "pending" | "claimed" | "cancelled";
  call?: PendingVoiceCall;
  callSid?: string;
  expiresAt: number;
};

/** The Redis pending-call record in memory: each run lapses at its TTL on the injected clock. */
export class MemoryPendingVoiceCallRepository implements PendingVoiceCallRepository {
  private readonly runs = new Map<string, RunRecord>();

  static create(options: { now?: () => number } = {}): MemoryPendingVoiceCallRepository {
    return new MemoryPendingVoiceCallRepository(options.now ?? Date.now);
  }

  private constructor(private readonly now: () => number) {}

  async put(input: {
    call: PendingVoiceCall;
    ttlSeconds: number;
  }): Promise<PendingVoiceCallPutResult> {
    const { call, ttlSeconds } = input;
    const state = this.live(call.scenarioRunId)?.state;
    if (state === "cancelled" || state === "claimed") {
      return { stored: false, reason: state } as const;
    }
    this.runs.set(call.scenarioRunId, {
      state: "pending",
      call,
      expiresAt: this.expiry(ttlSeconds),
    });
    return { stored: true } as const;
  }

  async peek({ scenarioRunId, nonce }: PendingVoiceCallKey): Promise<PendingVoiceCallPeekResult> {
    const call = this.live(scenarioRunId)?.call;
    return call && call.nonce === nonce ? { found: true, call } : { found: false };
  }

  async claim({ scenarioRunId, nonce }: PendingVoiceCallKey): Promise<PendingVoiceCallClaimResult> {
    const record = this.live(scenarioRunId);
    if (record?.state === "cancelled") return { claimed: false, reason: "cancelled" } as const;
    if (!record?.call || record.call.nonce !== nonce) {
      return { claimed: false, reason: "unknown" } as const;
    }
    const { call } = record;
    this.runs.set(scenarioRunId, {
      state: "claimed",
      callSid: record.callSid,
      expiresAt: this.expiry(VOICE_CALL_RECORD_TTL_SECONDS),
    });
    return { claimed: true, call } as const;
  }

  async cancel(input: {
    scenarioRunId: string;
    tombstoneTtlSeconds: number;
  }): Promise<VoiceCallCancelOutcome> {
    const record = this.live(input.scenarioRunId);
    this.runs.set(input.scenarioRunId, {
      state: "cancelled",
      callSid: record?.callSid,
      expiresAt: this.expiry(input.tombstoneTtlSeconds),
    });
    const outcome: VoiceCallCancelOutcome = { state: record?.state ?? "absent" };
    if (record?.callSid !== undefined) outcome.callSid = record.callSid;
    return outcome;
  }

  async attachCallSid(input: {
    scenarioRunId: string;
    callSid: string;
  }): Promise<PendingVoiceCallAttachResult> {
    const record = this.live(input.scenarioRunId);
    if (!record) return { attached: false, reason: "unknown" } as const;
    if (record.state === "cancelled") return { attached: false, reason: "cancelled" } as const;
    record.callSid = input.callSid;
    return { attached: true } as const;
  }

  private live(scenarioRunId: string): RunRecord | undefined {
    const record = this.runs.get(scenarioRunId);
    if (record && this.now() >= record.expiresAt) {
      this.runs.delete(scenarioRunId);
      return undefined;
    }
    return record;
  }

  private expiry(ttlSeconds: number): number {
    return this.now() + ttlSeconds * 1000;
  }
}
