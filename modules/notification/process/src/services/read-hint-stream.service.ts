import {
  READ_INVALIDATED_BROADCAST_EVENT_TYPE,
  readHintSchema,
  type ReadHint,
} from "@langwatch/notification-contract";
import type { PresenceApi } from "@langwatch/presence-contract";

type TenantEmitters = Pick<PresenceApi, "getTenantEmitter" | "cleanupTenantEmitter">;

/** The hints in a fan-out frame `{ event, timestamp }` (none or one); `event` is serialised. */
function hintsIn(frame: unknown): ReadHint[] {
  if (typeof frame !== "object" || frame === null || !("event" in frame)) return [];
  if (typeof frame.event !== "string") return [];
  try {
    const hint = readHintSchema.safeParse(JSON.parse(frame.event));
    return hint.success ? [hint.data] : [];
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
  async *watch({
    tenantIds,
    signal,
  }: {
    tenantIds: readonly string[];
    signal?: AbortSignal;
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
