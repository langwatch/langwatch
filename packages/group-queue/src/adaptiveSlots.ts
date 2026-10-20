import { type EventLoopUtilization, performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";

/** Above this share of a second spent running JavaScript, the process gives slots back. */
const BUSY_LOOP = 0.95;
/** Below this share, with every slot taken, jobs are waiting on IO and more slots fit. */
const IDLE_LOOP = 0.85;
/** Above this share of the heap limit, slots shrink before garbage collection takes over. */
const FULL_HEAP = 0.8;

/**
 * How many jobs a consumer runs at once. Jobs mostly wait on ClickHouse and Redis, so a fixed count
 * leaves a small pod's CPU idle and starves a big one: the count grows while every slot is taken
 * and the event loop has room, and shrinks when the loop or the heap is near full.
 */
export class AdaptiveSlots {
  #slots: number;
  #last: EventLoopUtilization = performance.eventLoopUtilization();
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly options: {
      floor: number;
      ceiling: number;
      /** Jobs running or queued for a slot now. */
      busy: () => number;
      onChange: (slots: number) => void;
      intervalMs?: number;
      /** Event-loop busy share since the last call and heap share; the process's own by default. */
      readLoad?: () => { loop: number; heap: number };
    },
  ) {
    this.#slots = options.floor;
  }

  current(): number {
    return this.#slots;
  }

  start(): void {
    if (this.#timer !== undefined || this.options.ceiling <= this.options.floor) return;
    this.#timer = setInterval(() => this.adjust(), this.options.intervalMs ?? 1000);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** One step: shrink by a fifth under pressure, grow by a quarter while saturated and idle. */
  adjust(): void {
    const { loop, heap } = (this.options.readLoad ?? (() => this.processLoad()))();
    const { floor, ceiling } = this.options;
    let next = this.#slots;
    if (loop > BUSY_LOOP || heap > FULL_HEAP) {
      next = Math.max(floor, Math.floor(this.#slots * 0.8));
    } else if (loop < IDLE_LOOP && this.options.busy() >= this.#slots * 0.9) {
      next = Math.min(ceiling, Math.ceil(this.#slots * 1.25));
    }
    if (next === this.#slots) return;
    this.#slots = next;
    this.options.onChange(next);
  }

  private processLoad(): { loop: number; heap: number } {
    const loop = performance.eventLoopUtilization(this.#last).utilization;
    this.#last = performance.eventLoopUtilization();
    const heap = getHeapStatistics();
    return { loop, heap: heap.used_heap_size / heap.heap_size_limit };
  }
}
