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

/** LAST_ACTIONS change what every other screen shows, so their flows run alone, after the rest. */
const LAST_ACTIONS = new Set(["editProjectSettings"]);

/** orderFlows splits the flows that may run side by side from those that must run last. */
export const orderFlows = (
  flows: readonly PlanFlow[],
): { together: PlanFlow[]; last: PlanFlow[] } => {
  const runsLast = (flow: PlanFlow): boolean =>
    flow.steps.some((step) => LAST_ACTIONS.has(step.action));
  return { together: flows.filter((flow) => !runsLast(flow)), last: flows.filter(runsLast) };
};

/** width reads a configured concurrency, one when absent or nonsense. */
export const width = (value: number | undefined): number =>
  value !== undefined && Number.isInteger(value) && value > 0 ? value : 1;
