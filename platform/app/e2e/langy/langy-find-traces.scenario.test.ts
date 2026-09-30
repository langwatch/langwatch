/**
 * Finding traces with the Trace Explorer open in front of the user.
 *
 * The project records thumbs down one way only: a `thumbs_up_down` event with
 * a vote of -1. No annotation, label or evaluator names it, and the words
 * "thumbs down" appear in no trace text, so a phrase search finds nothing.
 * Langy has to find the form the concept takes, put that filter on the page
 * through `explorer.setFilter`, and answer the count the page shows.
 *
 * A fake Explorer tab (`fake-explorer-tab.ts`) claims the actions, so the
 * browser leg is the one under test.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run langy-find-traces.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import { LANGWATCH_API_KEY, LW_BASE_URL } from "./config";
import { type FakeExplorerTab, openFakeExplorerTab } from "./fake-explorer-tab";
import { makeLangyAdapter, type PageContextChip } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";

const model = openai("gpt-5-mini");

const THUMBS_DOWN_FILTER =
  "event:thumbs_up_down AND event.attribute.event.metrics.vote:-1";
const THUMBS_DOWN = 5;
const THUMBS_UP = 4;
const NO_FEEDBACK = 6;
const VISIBILITY_TIMEOUT_MS = 120_000;

async function post({
  path,
  body,
}: {
  path: string;
  body: unknown;
}): Promise<void> {
  const res = await fetch(`${LW_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "X-Auth-Token": LANGWATCH_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(
      `POST ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
}

/**
 * Support traffic where feedback exists only as events. The texts say nothing
 * about thumbs, so the event is the only form the concept takes.
 */
async function seedFeedbackTraces({ runId }: { runId: string }): Promise<void> {
  const now = Date.now();
  const total = THUMBS_DOWN + THUMBS_UP + NO_FEEDBACK;
  for (let i = 0; i < total; i++) {
    const traceId = `trace_find_${runId}_${i}`;
    const startedAt = now - (i + 1) * 90_000;
    await post({
      path: "/api/collector",
      body: {
        spans: [
          {
            trace_id: traceId,
            span_id: `span_find_${runId}_${i}`,
            type: "llm",
            model: "gpt-5-mini",
            input: { type: "text", value: `where is order #20${i}?` },
            output: {
              type: "text",
              value: `Order #20${i} ships on Friday.`,
            },
            timestamps: {
              started_at: startedAt,
              finished_at: startedAt + 1_200,
            },
          },
        ],
        metadata: { labels: ["find-traces-seed"] },
      },
    });
    if (i >= THUMBS_DOWN + THUMBS_UP) continue;
    await post({
      path: "/api/events/track",
      body: {
        trace_id: traceId,
        event_type: "thumbs_up_down",
        metrics: { vote: i < THUMBS_DOWN ? -1 : 1 },
        timestamp: startedAt + 5_000,
      },
    });
  }
}

/** Polls until the Explorer counts the seeded events on top of what it had. */
async function waitForCount({
  tab,
  expected,
}: {
  tab: FakeExplorerTab;
  expected: number;
}): Promise<void> {
  const deadline = Date.now() + VISIBILITY_TIMEOUT_MS;
  let last = -1;
  while (Date.now() < deadline) {
    last = await tab.count({ query: THUMBS_DOWN_FILTER });
    if (last === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `The Explorer counted ${last} thumbs down traces, expected ${expected}. This is ingestion lag or a filter that does not compile, not a Langy answer.`,
  );
}

/** The page chip the Explorer attaches: window, lens and no search yet. */
function explorerChip({
  from,
  to,
}: {
  from: number;
  to: number;
}): PageContextChip {
  return {
    kind: "filter",
    label: "Traces · All Traces · Last 30 days",
    ref: [
      "data source: traces",
      "time range: Last 30 days",
      `from: ${new Date(from).toISOString()}`,
      `to: ${new Date(to).toISOString()}`,
      "built-in lens: All Traces (id: all-traces)",
      "grouping: flat",
      "sort: time desc",
    ].join("; "),
  };
}

function lastAssistantText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message.role !== "assistant") continue;
    return typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);
  }
  return "";
}

describe("Langy on a Trace Explorer the user is watching", () => {
  describe("when the user asks for the traces with a thumbs down", () => {
    /** @scenario "Asked for thumbs-down traces, Langy applies the event filter and answers the Explorer's count" */
    it("puts the event filter on the page and answers the page's count", async () => {
      const runId = Date.now().toString(36);
      // The adapter reads the chips on every turn, and the chip needs the
      // window the tab opened on, so it is added once the tab exists.
      const pageContext: PageContextChip[] = [];
      const langy = makeLangyAdapter({ pageContext });
      const tab = await openFakeExplorerTab({ adapter: langy });

      try {
        const before = await tab.count({ query: THUMBS_DOWN_FILTER });
        await seedFeedbackTraces({ runId });
        const expected = before + THUMBS_DOWN;
        await waitForCount({ tab, expected });

        const { from, to } = tab.state().timeRange;
        pageContext.push(explorerChip({ from, to }));

        const result = await runScenarioAndLog({
          config: {
            name: "thumbs down traces, found as events, shown on the page",
            description:
              "A support lead has the Trace Explorer open on the last 30 days with no search applied. End users rate answers with a thumbs up or down in the product, and the ratings reach LangWatch as events. The lead does not know how they are stored.",
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  `The answer states that ${expected} traces have a thumbs down`,
                  "The answer says or implies the list on the user's screen now shows those traces",
                  "The answer does not claim that no thumbs down traces exist",
                ],
              }),
            ],
            script: [
              scenario.user(
                "show me the traces where users gave a thumbs down",
              ),
              scenario.agent(),
              scenario.judge(),
            ],
          },
        });
        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);

        // The page carried a filter action, and what it applied counts the
        // thumbs down traces: the filter may be spelled another valid way.
        const applied = tab.claimedActions.filter(
          (action) =>
            action.kind === "explorer.setFilter" &&
            action.outcome === "executed" &&
            action.ok === true,
        );
        expect(
          applied.length,
          `no explorer.setFilter was carried by the page. Seen: ${JSON.stringify(
            tab.seenActions,
          )}. Dropped: ${JSON.stringify(
            tab.droppedActions.map((action) => action.kind),
          )}`,
        ).toBeGreaterThan(0);

        const onScreen = tab.state().queryText;
        expect(onScreen).toContain("thumbs_up_down");
        expect(await tab.count({ query: onScreen })).toBe(expected);

        expect(
          langy.state.toolOutputs.some((output) =>
            output.includes('"executedVia":"browser"'),
          ),
          "no action reported executedVia browser",
        ).toBe(true);

        expect(lastAssistantText(result.messages)).toContain(String(expected));
        expect(result.success).toBe(true);
      } finally {
        await tab.close();
      }
    }, 1_800_000);
  });
});
