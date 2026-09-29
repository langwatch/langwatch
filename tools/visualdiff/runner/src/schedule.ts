import type { PlanFlow } from "./protocol";

/**
 * runPool works through items on `width` lanes, each lane taking the next
 * item when it frees up. The first failure stops every lane taking another.
 */
export const runPool = async <Item>({
  items,
  width,
  work,
}: {
  items: readonly Item[];
  width: number;
  work: (job: { item: Item; lane: number }) => Promise<void>;
}): Promise<void> => {
  let next = 0;
  let failed = false;
  const lane = async (index: number): Promise<void> => {
    while (!failed) {
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
  take,
  spoiled,
  keep,
  onRecaptured,
}: {
  items: readonly Item[];
  width: number;
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
 * look join the routes; every other flow runs across the whole page pool once the routes are done
 * (each names what it creates with a `{uid}`, so they cannot collide); only a flow that declares
 * `serial` waits to run alone at the end.
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
