/**
 * The dashboards scenarios' world, after docs/agent-testing/check-the-world.mdx:
 * built from the scenario's parameters, read back as a few flat facts, and
 * reported as a "world state" tool span that the judge reads in the trace.
 */

import type { AgentInput } from "@langwatch/scenario";
import { trace } from "@opentelemetry/api";

import {
  type BoardItem,
  type BoardSnapshot,
  type Count,
  countOf,
  countProjectItems,
  diffBoards,
  readBoard,
  runBoardQueries,
} from "./board-state";
import { addWidget, type Board, createBoard, seedDashboardsProject } from "./dashboards-fixture";
import { seedTraffic } from "./langwatch-api";
import type { LangyAdapter } from "./langy-agent";
import { attachProvider, type SeededProject } from "./seed-organization";
import { dailyWindows, type TimeWindow } from "./traffic-pattern";
import { getSessionCookie } from "./trpc";

/** The facts of one case. The setup, the scenario text and the checks all read these values. */
export interface WorldParams {
  /** The seeded account owns its organization, so admin is the one role this seed plays. */
  role: "admin";
  /** Spread evenly over the UTC hours, so a multiple of 24. */
  tracesPerDay: number;
  /** traffic-pattern.ts seeds the last full UTC day and the day before it. */
  days: 2;
  board: string;
  decoy: string;
}

export interface World {
  params: WorldParams;
  project: SeededProject;
  board: Board;
  decoy: Board;
  /** Both seeded days, `[start, end)`. */
  window: TimeWindow;
  /** The board, the decoy and the project's item count right after setup. */
  initial: { board: BoardSnapshot; decoy: BoardSnapshot; projectItems: number };
}

/** The flat facts the "world state" span reports, named as the judge reads them. */
export interface WorldFacts {
  widgets_on_board: number;
  project_widget_count: number;
  decoy_widgets: number;
  /** What the newest item added to the board counts over the seeded days; null while none is. */
  chart_total: number | null;
  /** How many rows that count comes in: one per day for a per-day chart; null while none is. */
  chart_days: number | null;
}

/** One read of the world: the facts, and the snapshots the code checks compare. */
export interface WorldRead {
  facts: WorldFacts;
  board: BoardSnapshot;
  decoy: BoardSnapshot;
  addedToBoard: BoardItem[];
}

/** The decoy's own widget, so leaving the decoy alone means more than adding nothing to it. */
const DECOY_WIDGET = {
  name: "Traces this period",
  code: `export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div>{error.message}</div>;
  if (isLoading || data === null) return <div>Loading...</div>;
  return <div style={{ fontSize: 32 }}>{String(data[0] ? data[0].traces : 0)}</div>;
}`,
  queries: [
    {
      name: "main",
      sql: "SELECT count() AS traces FROM traces WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}",
    },
  ],
};

/** Hours share the day evenly only when the count is a positive multiple of 24. */
export function assertTracesPerDay(tracesPerDay: number): void {
  if (tracesPerDay % 24 !== 0 || tracesPerDay < 24) {
    throw new Error(`tracesPerDay must be a positive multiple of 24, got ${tracesPerDay}`);
  }
}

/**
 * A fresh project with Langy's model attached, `tracesPerDay` traces on each
 * seeded day, the board under test, and a decoy board carrying one widget.
 */
export async function setupWorld({
  label,
  params,
}: {
  label: string;
  params: WorldParams;
}): Promise<World> {
  assertTracesPerDay(params.tracesPerDay);
  const project = await seedDashboardsProject({ label });
  await attachProvider({
    cookie: await getSessionCookie(),
    organizationId: project.organizationId,
    projectId: project.projectId,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
  });
  const now = Date.now();
  await seedTraffic({ plan: { perHour: params.tracesPerDay / 24 }, now });
  const { previous, day } = dailyWindows(now);
  const board = await createBoard({ name: params.board });
  const decoy = await createBoard({ name: params.decoy });
  await addWidget({ dashboardId: decoy.id, widget: DECOY_WIDGET });
  const world: Omit<World, "initial"> = {
    params,
    project,
    board,
    decoy,
    window: { start: previous.start, end: day.end },
  };
  const [initialBoard, initialDecoy, projectItems] = await Promise.all([
    readBoard({ dashboardId: board.id }),
    readBoard({ dashboardId: decoy.id }),
    countProjectItems(),
  ]);
  return { ...world, initial: { board: initialBoard, decoy: initialDecoy, projectItems } };
}

/** The world as it is now, from the public routes, never from what Langy said. */
export async function readWorld(world: World): Promise<WorldRead> {
  const [board, decoy, projectItems] = await Promise.all([
    readBoard({ dashboardId: world.board.id }),
    readBoard({ dashboardId: world.decoy.id }),
    countProjectItems(),
  ]);
  const addedToBoard = diffBoards({ before: world.initial.board, after: board }).added;
  const newest = newestOf(addedToBoard);
  const counted = newest ? await countedOver({ item: newest, world }) : null;
  return {
    facts: {
      widgets_on_board: board.items.length,
      project_widget_count: projectItems,
      decoy_widgets: decoy.items.length,
      chart_total: counted?.total ?? null,
      chart_days: counted?.rows ?? null,
    },
    board,
    decoy,
    addedToBoard,
  };
}

/** readBoard lists widgets before charts, so list order is not age; createdAt is. */
function newestOf(items: BoardItem[]): BoardItem | undefined {
  return items.reduce<BoardItem | undefined>(
    (newest, item) =>
      !newest || Date.parse(item.resource.createdAt) > Date.parse(newest.resource.createdAt)
        ? item
        : newest,
    undefined,
  );
}

/** What the item counts over the seeded days, one bucket per day; null when nothing counts. */
async function countedOver({
  item,
  world,
}: {
  item: BoardItem;
  world: World;
}): Promise<Count | null> {
  return countOf(
    await runBoardQueries({
      snapshot: { dashboardId: world.board.id, items: [item] },
      window: world.window,
      granularitySeconds: 86_400,
    }),
  );
}

const tracer = trace.getTracer("langy-e2e-world");

/**
 * Reads the world inside a "world state" tool span. Called inside an agent
 * call, the span joins the scenario's thread, so the judge reads its output.
 */
export async function reportWorldState({
  world,
  moment,
}: {
  world: World;
  moment: string;
}): Promise<WorldRead> {
  return tracer.startActiveSpan("world state", async (span) => {
    try {
      const read = await readWorld(world);
      span.setAttributes({
        "langwatch.span.type": "tool",
        "langwatch.input": JSON.stringify({ type: "text", value: moment }),
        "langwatch.output": JSON.stringify({ type: "json", value: read.facts }),
      });
      console.log(`[world] ${moment}: ${JSON.stringify(read.facts)}`);
      return read;
    } finally {
      span.end();
    }
  });
}

/**
 * Reports the world when a conversation starts (after setup) and after every
 * turn. Wraps `call` in place, so the adapter's state and hooks stay its own.
 */
export function reportWorldStateEachTurn({
  adapter,
  world,
  report = reportWorldState,
}: {
  adapter: LangyAdapter;
  world: World;
  /** The reader of the world; a unit test swaps in a fake. */
  report?: (args: { world: World; moment: string }) => Promise<unknown>;
}): LangyAdapter {
  const ask = adapter.call.bind(adapter);
  return Object.assign(adapter, {
    call: async (input: AgentInput) => {
      if (adapter.state.conversationId === null) {
        await report({ world, moment: "after setup" });
      }
      const reply = await ask(input);
      const turn = input.messages.filter((message) => message.role === "user").length;
      await report({ world, moment: `after turn ${turn}` });
      return reply;
    },
  });
}
