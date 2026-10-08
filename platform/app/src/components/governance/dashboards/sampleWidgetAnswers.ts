/**
 * The invented answers behind the four governance dashboard widgets.
 *
 * The widgets in `governanceWidgets.ts` are real widgets in the product's own
 * format, and each one declares a query. Nothing can run those queries: the
 * cost rollup they ask for is not in the query catalog, so there is no SQL
 * this page could send anywhere. Rather than draw four broken charts, the page
 * hands the chart frame an answer factory instead of a catalog execution, and
 * this module is that factory.
 *
 * NOTHING HERE REACHES A DATABASE, and the signature is what proves it. The
 * factory takes a time frame and nothing else — no project, no tenant, no
 * client — so there is no identifier a row could be read on even by mistake.
 * That is a stronger guarantee than a comment promising not to read, and it is
 * checked in the type rather than at runtime for exactly that reason.
 *
 * The figures come from the same generators the Costs page draws from
 * (`~/components/governance/costs/sampleSeries`), so the invented organization
 * is ONE organization across the section: a reader moving from Costs to
 * Dashboards sees the same departments, the same agents and the same order of
 * magnitude rather than four unrelated fictions. Every figure is seeded rather
 * than rolled, so a widget paints the same shape on every render pass and the
 * server-rendered markup agrees with the client's first paint.
 *
 * A column name here is a contract with the chart code, which reads rows by
 * name: the keys below have to stay exactly the SELECT aliases of the matching
 * query, because a drifted column draws an empty chart that looks like missing
 * spend rather than like the mismatch it is.
 *
 * Spec: specs/governance/governance-dashboards.feature
 */
import { NOT_NAMED_LABEL } from "~/components/governance/costs/CostSpenderPanel";
import { sampleSpenderRows } from "~/components/governance/costs/sampleLanes";
import {
  recentMonths,
  SAMPLE_AGENTS,
  SAMPLE_DEPARTMENTS,
  sampleDaily,
  sampleRanked,
} from "~/components/governance/costs/sampleSeries";
import {
  frameSpanDays,
  type TimeFrame,
} from "~/components/governance/filters/timeControls";
import {
  type ChartQueryError,
  toChartQueryResult,
} from "~/features/custom-chart-playground/bridge/bridgeProtocol";
import type { ChartFrameExecuteQuery } from "~/features/custom-chart-playground/bridge/frameBridge";

import type { GovernanceWidgetId } from "./governanceWidgets";

/**
 * What the leading series spends in a MONTH, in US dollars. The same figure
 * the Costs page scales its sample panels from, so the two pages describe one
 * organization rather than two of different sizes.
 */
const SAMPLE_MONTHLY_TOP = 7_400;

/** Roughly how many days a bucket covers. Governance buckets are months. */
const DAYS_PER_BUCKET = 30;

/**
 * How many month buckets the frame in view covers.
 *
 * Every answer is sized from this, because the widgets on this page are read
 * side by side: a ranked panel scaled to a month under a time chart scaled to
 * a year puts the same money an order of magnitude apart on one screen, and
 * the reader learns the screen does not add up rather than what it spends.
 * That is the incoherence the Costs page was already fixed for.
 */
function frameBucketCount(frame: TimeFrame): number {
  return Math.max(1, Math.round(frameSpanDays({ frame }) / DAYS_PER_BUCKET));
}

/**
 * What one series spends across the whole window — the monthly top carried
 * over every bucket the frame holds. A ranked list has no series of its own to
 * be totalled from, so it is scaled by hand the way the Costs page scales the
 * two panels in the same position.
 */
function windowTopValue(frame: TimeFrame): number {
  return SAMPLE_MONTHLY_TOP * frameBucketCount(frame);
}

/**
 * The providers the stacked spend chart splits by. Written the way each vendor
 * writes its own name — these are read by a person, not matched against a
 * provider key.
 */
const SAMPLE_PROVIDERS = [
  "OpenAI",
  "Anthropic",
  "Azure OpenAI",
  "Google",
] as const;

/** The models the agents run on, handed out in turn so every one appears. */
const SAMPLE_MODELS = ["gpt-5", "claude-sonnet-5", "gemini-2.5-pro"] as const;

/** A column as the chart frame's wire format names it. */
interface SampleColumn {
  name: string;
  type: "String" | "Float64";
}

/** A query's answer before it is wrapped for the wire. */
interface SampleAnswer {
  columns: SampleColumn[];
  rows: Record<string, unknown>[];
}

const stringColumn = (name: string): SampleColumn => ({ name, type: "String" });
const costColumn = (): SampleColumn => ({ name: "cost_usd", type: "Float64" });

/**
 * Spend per month per provider, one row per pair.
 *
 * The bucket count follows the frame rather than being fixed, so narrowing to
 * three months draws three months instead of a stripe at the right-hand edge
 * of a twelve-month axis. Buckets are months because that is the finest one
 * any chip on this page offers (see `timeControls.ts`).
 */
function providerDayAnswer(frame: TimeFrame): SampleAnswer {
  const buckets = sampleDaily(
    recentMonths(frameBucketCount(frame)),
    SAMPLE_PROVIDERS,
    SAMPLE_MONTHLY_TOP,
  );

  return {
    columns: [stringColumn("bucket"), stringColumn("provider"), costColumn()],
    rows: buckets.flatMap((bucket) =>
      bucket.points.map((point) => ({
        bucket: bucket.day,
        provider: point.label,
        cost_usd: point.value,
      })),
    ),
  };
}

/**
 * Spend per department over the window, steeply ranked the way real spend
 * falls away.
 *
 * Ranked from the WINDOW total rather than from a month, so the bars beside
 * the person chart are the same size of money and narrowing the frame shrinks
 * them instead of relabelling a year of spend as a quarter of it.
 */
function departmentAnswer(frame: TimeFrame): SampleAnswer {
  return {
    columns: [stringColumn("department"), costColumn()],
    rows: sampleRanked(SAMPLE_DEPARTMENTS, windowTopValue(frame)).map(
      (row) => ({
        department: row.label,
        cost_usd: row.value,
      }),
    ),
  };
}

/**
 * Spend per person, taken from the Costs page's own spender list.
 *
 * Summed per person rather than per person-and-provider: that list carries one
 * row per pair, so somebody who uses two providers appears twice in it, and a
 * chart keyed on a person's name would draw them as two people.
 *
 * The row nobody is named on is KEPT, under the same wording the Costs page
 * uses for it. Dropping it would be tidier and would report a smaller bill
 * than the one the providers sent, which is the one thing a spend chart must
 * never do. It is ranked with the rest rather than pinned to the end: it is a
 * real share of the bill, and parking it last would understate it.
 *
 * Sorted biggest first, because the query this answers says `ORDER BY cost_usd
 * DESC` and the chart draws the rows in the order it receives them. Summing
 * into a map gives them back in the order the people were first seen, which is
 * not the same order and looks like an unranked ranked panel.
 */
function personAnswer(): SampleAnswer {
  const totalByPerson = new Map<string, number>();
  for (const row of sampleSpenderRows()) {
    // A withheld figure is skipped rather than read as zero: the spender list
    // carries `null` for a row whose amount is not held, and adding it in as 0
    // would draw somebody as having spent nothing rather than as unknown.
    if (row.amountUsd === null) continue;
    const person = row.label ?? NOT_NAMED_LABEL;
    totalByPerson.set(person, (totalByPerson.get(person) ?? 0) + row.amountUsd);
  }

  return {
    columns: [stringColumn("person"), costColumn()],
    rows: [...totalByPerson]
      .sort(([, a], [, b]) => b - a)
      .map(([person, cost]) => ({
        person,
        cost_usd: cost,
      })),
  };
}

/**
 * Spend per agent, with the model it runs on.
 *
 * Models are handed round the roster in turn rather than seeded, so all three
 * appear whatever the roster grows to. Agent names carry no environment suffix
 * — ADR-128 keys an agent on name AND environment, and gluing the two into one
 * string invents an agent the Agents screen has never heard of.
 *
 * Ranked from the window total for the same reason the department answer is:
 * this chart sits directly under the provider chart of the same money.
 */
function modelAgentAnswer(frame: TimeFrame): SampleAnswer {
  const ranked = sampleRanked(SAMPLE_AGENTS, windowTopValue(frame));

  return {
    columns: [stringColumn("model"), stringColumn("agent"), costColumn()],
    rows: ranked.map((row, index) => ({
      model: SAMPLE_MODELS[index % SAMPLE_MODELS.length]!,
      agent: row.label,
      cost_usd: row.value,
    })),
  };
}

type SampleAnswerBuilder = (frame: TimeFrame) => SampleAnswer;

/**
 * Which builder answers which widget's query.
 *
 * A table rather than a chain of name checks, and keyed on the widget id
 * rather than on a loose string: the map is exhaustive over the four widgets,
 * so a fifth one cannot be added without an answer being written for it here.
 * The typecheck says so before the page draws a widget with a blank in it.
 *
 * Every builder takes the frame whether or not it reads it, so the table has
 * one signature and a builder that starts following the window later does not
 * change the table's shape.
 */
const SAMPLE_ANSWERS: Record<GovernanceWidgetId, SampleAnswerBuilder> = {
  provider_day: providerDayAnswer,
  department: departmentAnswer,
  person: personAnswer,
  model_agent: modelAgentAnswer,
};

/**
 * The builder for a query name, or nothing if none is written for it.
 *
 * The name arrives off the bridge as a plain string, so membership is checked
 * before it is used as a key rather than asserted to be one of the four.
 */
function sampleAnswerBuilder(
  queryName: string,
): SampleAnswerBuilder | undefined {
  return Object.hasOwn(SAMPLE_ANSWERS, queryName)
    ? SAMPLE_ANSWERS[queryName as GovernanceWidgetId]
    : undefined;
}

/**
 * What answers a statement while the sample choice is OFF: nothing, with the
 * reason.
 *
 * Sample off is a request — do not show me invented figures — and every figure
 * this page can produce is invented. It is also the state the page OPENS in,
 * and the banner that admits the figures are invented is only drawn with
 * sample on. So an answer handed over in this state is invented money on
 * screen with nothing anywhere saying so, which is the one thing this page
 * exists not to do.
 *
 * A refusal rather than an empty result, for the same reason the factory below
 * refuses an unknown query: no rows reads as an organization that spent
 * nothing. This says which switch is off instead.
 *
 * It carries its own title because nothing here FAILED. A reader has a switch
 * turned off, which is the state the page opens in, and a heading that says
 * the query failed sends a cost owner hunting for a broken read that does not
 * exist — the same reason the card draws "Nothing measured yet." instead of a
 * red panel. The words travel with the refusal so the one place that shows
 * them cannot put a failure heading over them.
 */
export const SAMPLE_IS_OFF: ChartQueryError = {
  code: "governance_sample_data_off",
  title: "Sample data is off",
  message:
    "Every figure behind this widget is invented, so nothing is drawn until you ask to see sample data.",
};

export const refuseWhileSampleIsOff: ChartFrameExecuteQuery = () =>
  Promise.reject(
    Object.assign(new Error(SAMPLE_IS_OFF.message), SAMPLE_IS_OFF),
  );

/**
 * The answer factory the dashboards page hands its chart frames.
 *
 * A query with no answer written for it is REFUSED by name rather than
 * answered with an empty result: an empty chart reads as an organization that
 * spent nothing, and a widget whose query nobody wrote an answer for is a bug
 * in this file that should say so.
 */
export function createSampleExecuteQuery({
  frame,
}: {
  frame: TimeFrame;
}): ChartFrameExecuteQuery {
  return ({ queryName }) => {
    const buildAnswer = sampleAnswerBuilder(queryName);
    if (!buildAnswer) {
      return Promise.reject(
        new Error(`No sample answer for query "${queryName}"`),
      );
    }
    const answer = buildAnswer(frame);

    return Promise.resolve(
      toChartQueryResult({
        columns: answer.columns,
        rows: answer.rows,
        statistics: null,
        truncated: false,
        diagnostics: [],
        // The buckets are generated from the frame in hand, so the answer does
        // follow the window in view; the granularity is a month whatever the
        // frame asks for, so it does not follow that.
        followsTimeWindow: true,
        followsGranularity: false,
      }),
    );
  };
}
