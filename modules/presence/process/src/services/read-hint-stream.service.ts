import {
  READ_INVALIDATED_BROADCAST_EVENT_TYPE,
  readHintSchema,
  type PresenceApi,
  type ReadHint,
} from "@langwatch/presence-contract";
import { UPGRADE_READ_HINT_SCOPE, upgradeReadHintSchema } from "@langwatch/upgrade/runner";
import type { z } from "zod";

type TenantEmitters = Pick<PresenceApi, "getTenantEmitter" | "cleanupTenantEmitter">;

/** The serialised `event` of a fan-out frame `{ event, timestamp }`; none when malformed. */
function eventIn<Schema extends z.ZodType>(frame: unknown, schema: Schema): z.infer<Schema>[] {
  if (typeof frame !== "object" || frame === null || !("event" in frame)) return [];
  if (typeof frame.event !== "string") return [];
  try {
    const parsed = schema.safeParse(JSON.parse(frame.event));
    return parsed.success ? [parsed.data] : [];
  } catch {
    return [];
  }
}

/** Relays the `read_invalidated` hints of a stream's tenants from the process's tenant fan-out. */
export class ReadHintStreamService {
  static create(input: { emitters: TenantEmitters }): ReadHintStreamService {
    return new ReadHintStreamService(input.emitters);
  }

  private constructor(private readonly emitters: TenantEmitters) {}

  // ponytail: a member without that read's permission learns only that something under it
  // changed; per-read filtering if that ever matters. The refetch enforces the read's permission.
  watch({
    tenantIds,
    signal,
  }: {
    tenantIds: readonly string[];
    signal?: AbortSignal;
  }): AsyncGenerator<ReadHint> {
    return this.relay({ tenantIds, signal, hintsIn: (frame) => eventIn(frame, readHintSchema) });
  }

  /**
   * The upgrade runner's hints (round 8, U2-LIVE): only frames on the platform upgrade scope, which
   * no tenant shares, and only those the runner's own schema accepts. The door asks `ops:view`.
   */
  watchUpgrades({ signal }: { signal?: AbortSignal }): AsyncGenerator<ReadHint> {
    return this.relay({
      tenantIds: [UPGRADE_READ_HINT_SCOPE],
      signal,
      hintsIn: (frame) => eventIn(frame, upgradeReadHintSchema).map(({ path }) => ({ path })),
    });
  }

  private async *relay({
    tenantIds,
    signal,
    hintsIn,
  }: {
    tenantIds: readonly string[];
    signal: AbortSignal | undefined;
    hintsIn: (frame: unknown) => ReadHint[];
  }): AsyncGenerator<ReadHint> {
    const tenants = [...new Set(tenantIds)];
    const queued: unknown[] = [];
    let wake: (() => void) | null = null;
    const onFrame = (...args: unknown[]) => {
      queued.push(args[0]);
      wake?.();
    };
    const onAbort = () => wake?.();
    const emitters = tenants.map((tenantId) => this.emitters.getTenantEmitter(tenantId));
    for (const emitter of emitters) emitter.on(READ_INVALIDATED_BROADCAST_EVENT_TYPE, onFrame);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      while (!signal?.aborted) {
        if (queued.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
          continue;
        }
        yield* hintsIn(queued.shift());
      }
    } finally {
      for (const emitter of emitters) emitter.off(READ_INVALIDATED_BROADCAST_EVENT_TYPE, onFrame);
      signal?.removeEventListener("abort", onAbort);
      for (const tenantId of tenants) this.emitters.cleanupTenantEmitter(tenantId);
    }
  }
}
