import { availableParallelism, loadavg } from "node:os";

import { note, type PlanFlow } from "./protocol.ts";

/** PAUSE_MILLIS is how often a lane over the limit asks again whether it may take work. */
const PAUSE_MILLIS = 1000;

/** Machine is what the lane limit reads: the CPUs and the 1-minute load average. */
export interface Machine {
  cpus: number;
  load: number;
}

const readMachine = (): Machine => ({ cpus: availableParallelism(), load: loadavg()[0] ?? 0 });

/**
 * laneLimit is how many of `max` lanes may work: all while the load stays under the CPUs,
 * the CPUs' share of max above it, one fewer per crashed renderer, never under one.
 */
export const laneLimit = ({
  max,
  cpus,
  load,
  crashes,
}: Machine & { max: number; crashes: number }): number => {
  const byLoad = cpus > 0 && load > cpus ? Math.floor((max * cpus) / load) : max;
  return Math.max(1, Math.min(byLoad, max - crashes));
};

/** Throttle is a side's live lane limit: the machine's load, backed off per renderer crash. */
export class Throttle {
  private crashes = 0;
  private last = 0;

  constructor(
    private readonly side: string,
    private readonly max: number,
    private readonly machine: () => Machine = readMachine,
  ) {}

  crashed(): void {
    this.crashes += 1;
  }

  limit(): number {
    const machine = this.machine();
    const limit = laneLimit({ max: this.max, crashes: this.crashes, ...machine });
    if (limit !== this.last && this.last !== 0) {
      const why = `load ${machine.load.toFixed(1)} on ${machine.cpus} CPUs, ${this.crashes} crash(es)`;
      note({ text: `${this.side} pages: ${limit} of ${this.max} (${why})`, err: process.stderr });
    }
    this.last = limit;
    return limit;
  }
}

/**
 * runPool works through items on `width` lanes, each lane taking the next item when it frees
 * up; a lane at or past `limit()` waits instead. The first failure stops every lane taking another.
 */
export const runPool = async <Item>({
  items,
  width,
  work,
  limit,
  pauseMillis = PAUSE_MILLIS,
}: {
  items: readonly Item[];
  width: number;
  work: (job: { item: Item; lane: number }) => Promise<void>;
  limit?: () => number;
  pauseMillis?: number;
}): Promise<void> => {
  let next = 0;
  let failed = false;
  const lane = async (index: number): Promise<void> => {
    while (!failed && next < items.length) {
      if (index > 0 && limit !== undefined && index >= limit()) {
        await new Promise((resolve) => setTimeout(resolve, pauseMillis));
        continue;
      }
      const item = items[next];
      if (item === undefined) return;
      next += 1;
      try {
        await work({ item, lane: index });
      } catch (thrown) {
        failed = true;
        throw thrown;
      }
    }
  };
  const lanes = Math.max(1, Math.min(width, items.length));
  await Promise.all(Array.from({ length: lanes }, (_, index) => lane(index)));
};

/**
 * runPoolWithRecapture runs items through runPool and holds back every result `spoiled`
 * rejects; once the pool is done each is taken again on lane 0, alone, and only that retake
 * is kept. It returns the items it held back.
 */
export const runPoolWithRecapture = async <Item, Result>({
  items,
  width,
  limit,
  take,
  spoiled,
  keep,
  onRecaptured,
}: {
  items: readonly Item[];
  width: number;
  limit?: () => number;
  take: (job: { item: Item; lane: number }) => Promise<Result>;
  spoiled: (result: Result) => boolean;
  keep: (result: Result) => void;
  /** onRecaptured hears how long the retakes alone took. */
  onRecaptured?: (millis: number) => void;
}): Promise<Item[]> => {
  const heldBack: Item[] = [];
  await runPool({
    items,
    width,
    limit,
    work: async ({ item, lane }) => {
      const result = await take({ item, lane });
      if (spoiled(result)) heldBack.push(item);
      else keep(result);
    },
  });
  const startedAt = Date.now();
  for (const item of heldBack) keep(await take({ item, lane: 0 }));
  onRecaptured?.(Date.now() - startedAt);
  return heldBack;
};

/** READ_ACTIONS only look: a flow of nothing else may run while other pages capture routes. */
const READ_ACTIONS = new Set(["go", "wait", "sendTrace", "openTrace", "createScenario"]);

/** FlowOrder is when each flow may run: beside the routes, after them, or alone at the end. */
export interface FlowOrder {
  readers: PlanFlow[];
  writers: PlanFlow[];
  last: PlanFlow[];
}

/**
 * orderFlows sorts flows into FlowOrder, keeping the configured order in each. Flows that only
 * look join the routes; the rest run across the page pool once the routes are done (`{uid}`
 * keeps what they create apart); a flow that declares `serial` runs alone at the end.
 */
export const orderFlows = (flows: readonly PlanFlow[]): FlowOrder => {
  const alone = (flow: PlanFlow): boolean => flow.serial === true;
  const reads = (flow: PlanFlow): boolean =>
    flow.steps.every((step) => READ_ACTIONS.has(step.action));
  return {
    readers: flows.filter((flow) => !alone(flow) && reads(flow)),
    writers: flows.filter((flow) => !alone(flow) && !reads(flow)),
    last: flows.filter(alone),
  };
};

/** width reads a configured concurrency, one when absent or nonsense. */
export const width = (value: number | undefined): number =>
  value !== undefined && Number.isInteger(value) && value > 0 ? value : 1;
