import { type EventLoopUtilization, performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";

/** Above this share of a second spent running JavaScript, the process gives slots back. */
const BUSY_LOOP = 0.95;
/** Below this share, with every slot taken, the process has room for more slots. */
const IDLE_LOOP = 0.85;
/** Above this share of the heap limit, slots shrink before garbage collection takes over. */
const FULL_HEAP = 0.8;
/** The most slots a consumer ever runs, whatever its load (Alex, 2026-10-20). */
export const MAX_SLOTS = 1000;
/** Slots count as all taken when, on average, this share was taken as each job finished. */
const SATURATED = 0.9;
/** A growth step is kept only when it raised completed jobs per second by this share. */
const MEANINGFUL_GAIN = 0.05;
/** Median job duration at this multiple of its recent baseline, throughput flat: shrink. */
const DURATION_SPIKE = 2;
/** Failed jobs at this share of finished ones, and twice their baseline share: shrink. */
const FAILURE_SHARE = 0.1;
/** Measurements a consumer holds its count for after stepping back or shrinking. */
const HOLD_MEASUREMENTS = 30;
/** Weight of the newest measurement in the recent baselines. */
const BASELINE_WEIGHT = 0.25;
/** A measurement waits for this many finished jobs, or for MAX_WINDOW_STEPS steps. */
const MIN_FINISHED = 50;
const MAX_WINDOW_STEPS = 10;
/** Durations kept per measurement for the median; past this they are sampled. */
const DURATION_SAMPLES = 4096;

/** What the jobs finished since the last measurement did. */
export interface WorkSample {
  completedPerSecond: number;
  medianDurationMs: number;
  /** Failed jobs over finished ones, at most 1. */
  failureShare: number;
  /** Share of the slots taken as each job finished: near 1, work was waiting for a slot. */
  busyShare: number;
}

/**
 * How many jobs a consumer runs at once: while every slot is taken it grows by a quarter and keeps
 * the step only if completed jobs per second rose, so it stops where the stores stop absorbing
 * work; it shrinks by a fifth on rising duration, failures, loop or heap (adaptive-slots.feature).
 */
export class AdaptiveSlots {
  #slots: number;
  #last: EventLoopUtilization = performance.eventLoopUtilization();
  #timer: ReturnType<typeof setInterval> | undefined;
  /** The count and throughput before the last growth step, until that step is judged. */
  #probe: { from: number; completedPerSecond: number } | undefined;
  /** The first measurement after a change straddles it, so it is discarded. */
  #settling = false;
  #hold = 0;
  #baseline: WorkSample | undefined;
  #windowStart: number;
  #windowSteps = 0;
  #finished = 0;
  #failed = 0;
  #busySum = 0;
  #durations: number[] = [];

  constructor(
    private readonly options: {
      floor: number;
      /** Jobs running or queued for a slot now. */
      busy: () => number;
      onChange: (slots: number) => void;
      intervalMs?: number;
      /** Event-loop busy share since the last call and heap share; the process's own by default. */
      readLoad?: () => { loop: number; heap: number };
      /** The work since the last measurement, or nothing yet; the reported jobs by default. */
      readWork?: () => WorkSample | undefined;
      now?: () => number;
    },
  ) {
    this.#slots = options.floor;
    this.#windowStart = this.now();
  }

  current(): number {
    return this.#slots;
  }

  /** A job left its slot after `durationMs`, whatever its outcome. */
  jobFinished({ durationMs }: { durationMs: number }): void {
    this.#finished += 1;
    this.#busySum += Math.min(this.options.busy(), this.#slots);
    if (this.#durations.length < DURATION_SAMPLES) {
      this.#durations.push(durationMs);
      return;
    }
    const index = Math.floor(Math.random() * this.#finished);
    if (index < DURATION_SAMPLES) this.#durations[index] = durationMs;
  }

  /** A job's handler failed; a hand-back is not a failure. */
  jobFailed(): void {
    this.#failed += 1;
  }

  start(): void {
    if (this.#timer !== undefined || this.options.floor >= MAX_SLOTS) return;
    this.#timer = setInterval(() => this.adjust(), this.options.intervalMs ?? 1000);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** One step of the control rule; the timer calls it once an interval. */
  adjust(): void {
    const { loop, heap } = (this.options.readLoad ?? (() => this.processLoad()))();
    if (loop > BUSY_LOOP || heap > FULL_HEAP) {
      this.shrink();
      return;
    }
    const work = (this.options.readWork ?? (() => this.takeWork()))();
    if (work === undefined) return;
    if (this.#settling) {
      this.#settling = false;
      return;
    }
    const baseline = this.#baseline;
    this.#baseline = blend({ baseline, sample: work });
    if (baseline !== undefined && underStrain({ baseline, sample: work })) {
      this.shrink();
      return;
    }
    if (this.judgeProbe({ work }) === "stepped back") return;
    if (this.#hold > 0) {
      this.#hold -= 1;
      return;
    }
    const ceiling = Math.max(this.options.floor, MAX_SLOTS);
    if (loop >= IDLE_LOOP || this.#slots >= ceiling || work.completedPerSecond <= 0) return;
    if (work.busyShare < SATURATED) return;
    this.#probe = { from: this.#slots, completedPerSecond: work.completedPerSecond };
    this.set(Math.min(ceiling, Math.ceil(this.#slots * 1.25)));
  }

  /** A growth step that added no meaningful throughput is undone, then the count holds. */
  private judgeProbe({ work }: { work: WorkSample }): "kept" | "stepped back" {
    const probe = this.#probe;
    this.#probe = undefined;
    if (!probe || work.completedPerSecond >= probe.completedPerSecond * (1 + MEANINGFUL_GAIN)) {
      return "kept";
    }
    this.#hold = HOLD_MEASUREMENTS;
    this.set(probe.from);
    return "stepped back";
  }

  private shrink(): void {
    this.#probe = undefined;
    this.#hold = HOLD_MEASUREMENTS;
    this.set(Math.max(this.options.floor, Math.floor(this.#slots * 0.8)));
  }

  private set(next: number): void {
    if (next === this.#slots) return;
    this.#slots = next;
    this.#settling = true;
    this.resetWindow();
    this.options.onChange(next);
  }

  /** The reported jobs since the window opened, once it holds enough of them. */
  private takeWork(): WorkSample | undefined {
    this.#windowSteps += 1;
    if (this.#finished < MIN_FINISHED && this.#windowSteps < MAX_WINDOW_STEPS) return undefined;
    const seconds = Math.max(this.now() - this.#windowStart, 1) / 1000;
    const sample = {
      completedPerSecond: this.#finished / seconds,
      medianDurationMs: median({ values: this.#durations }),
      failureShare: Math.min(1, this.#failed / Math.max(this.#finished, 1)),
      busyShare:
        this.#finished === 0
          ? Math.min(this.options.busy(), this.#slots) / this.#slots
          : this.#busySum / (this.#finished * this.#slots),
    };
    this.resetWindow();
    return sample;
  }

  private resetWindow(): void {
    this.#windowStart = this.now();
    this.#windowSteps = 0;
    this.#finished = 0;
    this.#failed = 0;
    this.#busySum = 0;
    this.#durations = [];
  }

  private now(): number {
    return (this.options.now ?? (() => performance.now()))();
  }

  private processLoad(): { loop: number; heap: number } {
    const loop = performance.eventLoopUtilization(this.#last).utilization;
    this.#last = performance.eventLoopUtilization();
    const heap = getHeapStatistics();
    return { loop, heap: heap.used_heap_size / heap.heap_size_limit };
  }
}

/** Jobs take twice as long with no more throughput, or failures doubled past a tenth. */
function underStrain({ baseline, sample }: { baseline: WorkSample; sample: WorkSample }): boolean {
  const slower =
    sample.medianDurationMs >= baseline.medianDurationMs * DURATION_SPIKE &&
    sample.completedPerSecond < baseline.completedPerSecond * (1 + MEANINGFUL_GAIN);
  const failing =
    sample.failureShare >= FAILURE_SHARE && sample.failureShare >= baseline.failureShare * 2;
  return slower || failing;
}

function blend({
  baseline,
  sample,
}: {
  baseline: WorkSample | undefined;
  sample: WorkSample;
}): WorkSample {
  if (baseline === undefined) return sample;
  const mix = (previous: number, next: number) => previous + (next - previous) * BASELINE_WEIGHT;
  return {
    completedPerSecond: mix(baseline.completedPerSecond, sample.completedPerSecond),
    medianDurationMs: mix(baseline.medianDurationMs, sample.medianDurationMs),
    failureShare: mix(baseline.failureShare, sample.failureShare),
    busyShare: mix(baseline.busyShare, sample.busyShare),
  };
}

function median({ values }: { values: number[] }): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
