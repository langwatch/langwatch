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
}: {
  items: readonly Item[];
  width: number;
  take: (job: { item: Item; lane: number }) => Promise<Result>;
  spoiled: (result: Result) => boolean;
  keep: (result: Result) => void;
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
  for (const item of heldBack) keep(await take({ item, lane: 0 }));
  return heldBack;
};

/** READ_ACTIONS only look: a flow of nothing else may run while other pages capture routes. */
const READ_ACTIONS = new Set(["go", "wait", "sendTrace", "openTrace", "createScenario"]);

/**
 * VIEW_ACTIONS change what other screens show (a view's saved filters), and PROJECT_ACTIONS
 * change every screen (the project's name): their flows run alone, after the rest, the
 * project's very last.
 */
const VIEW_ACTIONS = new Set(["click", "type", "select", "fill"]);
const PROJECT_ACTIONS = new Set(["editProjectSettings"]);

/** FlowOrder is when each flow may run: beside the routes, after them, or alone at the end. */
export interface FlowOrder {
  readers: PlanFlow[];
  writers: PlanFlow[];
  last: PlanFlow[];
}

/** orderFlows sorts flows into FlowOrder, keeping the configured (longest first) order in each. */
export const orderFlows = (flows: readonly PlanFlow[]): FlowOrder => {
  const uses = (flow: PlanFlow, actions: Set<string>): boolean =>
    flow.steps.some((step) => actions.has(step.action));
  const reads = (flow: PlanFlow): boolean =>
    flow.steps.every((step) => READ_ACTIONS.has(step.action));
  const alone = (flow: PlanFlow): boolean =>
    uses(flow, VIEW_ACTIONS) || uses(flow, PROJECT_ACTIONS);
  return {
    readers: flows.filter(reads),
    writers: flows.filter((flow) => !reads(flow) && !alone(flow)),
    last: [
      ...flows.filter((flow) => alone(flow) && !uses(flow, PROJECT_ACTIONS)),
      ...flows.filter((flow) => uses(flow, PROJECT_ACTIONS)),
    ],
  };
};

/** width reads a configured concurrency, one when absent or nonsense. */
export const width = (value: number | undefined): number =>
  value !== undefined && Number.isInteger(value) && value > 0 ? value : 1;
