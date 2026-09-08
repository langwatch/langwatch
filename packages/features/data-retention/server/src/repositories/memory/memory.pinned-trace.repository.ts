import {
  pinnedTraceSchema,
  type PinSource,
  type PinTraceInput,
  type PinnedTrace,
  type UnpinTraceInput,
} from "@langwatch/data-retention-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";
import type { PinnedTraceRepository } from "../pinned-trace.repository.ts";

const PINNED_TRACE_KSUID_RESOURCE = "pin";

function pinKey(input: UnpinTraceInput): string {
  return `${input.projectId}:${input.traceId}`;
}

export class MemoryPinnedTraceRepository implements PinnedTraceRepository {
  #pins = new Map<string, PinnedTrace>();

  private constructor() {}

  static create(): MemoryPinnedTraceRepository {
    return new MemoryPinnedTraceRepository();
  }

  async findByProjectAndTrace(input: UnpinTraceInput): Promise<PinnedTrace | null> {
    const pin = this.#pins.get(pinKey(input));

    return pin ? structuredClone(pin) : null;
  }

  async findAllByProject({ projectId }: { projectId: string }): Promise<PinnedTrace[]> {
    return [...this.#pins.values()]
      .filter((pin) => pin.projectId === projectId)
      .map((pin) => structuredClone(pin));
  }

  async findAllTraceIds({ projectId }: { projectId: string }): Promise<string[]> {
    return [...this.#pins.values()]
      .filter((pin) => pin.projectId === projectId)
      .map((pin) => pin.traceId);
  }

  /**
   * The Prisma twin upserts, and only a manual pin rewrites an existing row:
   * a share's automatic pin must not overwrite the reason a person typed.
   */
  async create(params: PinTraceInput & { source: PinSource }): Promise<PinnedTrace> {
    const key = pinKey(params);
    const previous = this.#pins.get(key);

    if (previous && params.source !== "manual") {
      return structuredClone(previous);
    }

    const pin = pinnedTraceSchema.parse({
      id: previous?.id ?? generate(PINNED_TRACE_KSUID_RESOURCE).toString(),
      projectId: params.projectId,
      traceId: params.traceId,
      userId: (previous && params.userId === void 0 ? previous.userId : params.userId) ?? null,
      source: params.source,
      reason: params.reason ?? null,
      createdAt: previous?.createdAt ?? toDate(nowInstant()),
    });

    this.#pins.set(key, pin);

    return structuredClone(pin);
  }

  async delete(input: UnpinTraceInput): Promise<void> {
    this.#pins.delete(pinKey(input));
  }

  async hasManualPin(input: UnpinTraceInput): Promise<boolean> {
    return this.#pins.get(pinKey(input))?.source === "manual";
  }
}
