/**
 * The page after the one being judged is read while the judging runs, handed
 * over when the run asks for it, and dropped when the run stops or breaks.
 *
 * The classifier is the shipped null one behind a gate this suite holds, so
 * the judging of one page is held open for exactly as long as the assertion
 * needs: what is proved is that the next page's read started before this
 * page's judging resolved.
 *
 * @see ../instant-eval-run.executor.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it, vi } from "vitest";

import type {
  InstantEvalClassifier,
  InstantEvalClassifyRequest,
  InstantEvalJudgement,
} from "../../classifier/classifier";
import { NullInstantEvalClassifier } from "../../classifier/null.client";
import { createInstantEvalRunExecutor } from "../instant-eval-run.executor";
import type { InstantEvalJudgmentRecord } from "../judgments";
import { instantEvalRunQuestions } from "../questions";
import type {
  InstantEvalPreparedPage,
  InstantEvalRowKey,
  InstantEvalRowSource,
} from "../row-source";
import {
  calls,
  NOW,
  PROJECT_ID,
  RUN_ID,
  rowKey,
} from "./instantEvalRunExecutorFakes";

/** The null classifier, answering only once this suite lets it. */
class GatedNullClassifier implements InstantEvalClassifier {
  private readonly inner = new NullInstantEvalClassifier();
  readonly limits = this.inner.limits;
  readonly pricing = this.inner.pricing;
  private release: () => void = () => undefined;
  readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  open(): void {
    this.release();
  }

  async classify(
    _request: InstantEvalClassifyRequest,
    _signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    await this.gate;
    return await this.inner.classify();
  }
}

const questions = instantEvalRunQuestions(calls);

/** Pages of keys, in the order the key pass hands them out. */
const PAGES: InstantEvalRowKey[][] = [
  [rowKey("t1"), rowKey("t2")],
  [rowKey("t3"), rowKey("t4")],
  [rowKey("t5")],
];

function harness({
  classifier,
  isCancelled = async () => false,
}: {
  classifier: GatedNullClassifier;
  isCancelled?: () => Promise<boolean>;
}) {
  const reads: { after: string | null; startedAt: number }[] = [];
  let tick = 0;
  let judging = 0;
  let readsWhileJudging = 0;

  const rowSource: InstantEvalRowSource = {
    probe: vi.fn(),
    count: vi.fn(),
    texts: vi.fn(),
    keys: vi.fn(async ({ after }) => {
      const index = after
        ? PAGES.findIndex((page) => page.at(-1)?.traceId === after.traceId) + 1
        : 0;
      return { keys: PAGES[index] ?? [], hasMore: index < PAGES.length - 1 };
    }),
    read: vi.fn(async ({ keys }): Promise<InstantEvalPreparedPage> => {
      const after = keys[0]?.traceId ?? null;
      reads.push({ after, startedAt: tick++ });
      if (judging > 0) readsWhileJudging += 1;
      return {
        rows: keys.length,
        hydration: { keys } as unknown as InstantEvalPreparedPage["hydration"],
      };
    }),
    judgePrepared: vi.fn(async ({ page }) => {
      judging += 1;
      try {
        const keys = (
          page.hydration as unknown as { keys: InstantEvalRowKey[] }
        ).keys;
        const rows = [];
        for (const key of keys) {
          const judgement = await classifier.classify({
            projectId: PROJECT_ID,
            text: `text of ${key.traceId}`,
            questions: questions.map((question) => question.question),
          });
          rows.push({
            TraceId: key.traceId,
            annoyed: judgement.verdicts[0]?.probability ?? null,
          });
        }
        return {
          columns: [],
          rows,
          usage: { requests: keys.length, inputTokens: 0, skipped: {} },
        };
      } finally {
        judging -= 1;
      }
    }),
    judge: vi.fn(),
  };

  const inserted: InstantEvalJudgmentRecord[][] = [];
  const executor = createInstantEvalRunExecutor({
    runs: {
      create: vi.fn(),
      list: vi.fn(),
      findById: vi.fn(async () => ({
        id: RUN_ID,
        projectId: PROJECT_ID,
        sql: "SELECT TraceId, eval(conversation(ConversationId), 'x') AS annoyed FROM analytics.traces",
        parameters: {},
        questions: JSON.parse(JSON.stringify(questions)) as unknown,
        plan: JSON.parse(JSON.stringify(calls)) as unknown,
        rowLimit: 10_000,
      })),
    } as never,
    judgments: {
      insert: vi.fn(async (records: readonly InstantEvalJudgmentRecord[]) => {
        inserted.push([...records]);
      }),
      page: vi.fn(),
      sample: vi.fn(),
    },
    rowSource,
    classifier: () => classifier,
    spendRecorder: { recordSpend: vi.fn() },
    projectKey: async () => "lwql-secret",
    maxConcurrency: 4,
    protections: async () => ({}) as never,
    isCancelled,
    now: () => NOW,
  });

  const judgePage = (page: number, afterTraceId: string | null) =>
    executor.judgePage({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      page,
      afterTraceId,
      afterSpanId: null,
      pageSize: 2,
      remaining: 5 - 2 * (page - 1),
      keyColumns: ["ThreadId"],
    });

  return {
    rowSource,
    reads,
    inserted,
    judgePage,
    readsWhileJudging: () => readsWhileJudging,
  };
}

/** Lets every microtask and the fakes' awaits settle, without releasing the gate. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

describe("given a run whose classifier is still busy with a page", () => {
  describe("when the page is being judged", () => {
    /** @scenario "The next page is read while the current one is judged" */
    it("starts reading the next page before this page's judging resolves", async () => {
      const classifier = new GatedNullClassifier();
      const { reads, judgePage, readsWhileJudging } = harness({ classifier });

      const first = judgePage(1, null);
      await settle();

      // Page one's read happened, and page two's has begun, while the
      // classifier has not answered a single question yet.
      expect(reads.map((read) => read.after)).toEqual(["t1", "t3"]);
      expect(readsWhileJudging()).toBe(1);

      classifier.open();
      const outcome = await first;
      expect(outcome).toMatchObject({
        rows: 2,
        cursor: "t2",
        hasNextPage: true,
      });
    });

    /** @scenario "The next page is read while the current one is judged" */
    it("hands the read page to the intent that asks for it, reading it once", async () => {
      const classifier = new GatedNullClassifier();
      classifier.open();
      const { rowSource, reads, inserted, judgePage } = harness({ classifier });

      await judgePage(1, null);
      const second = await judgePage(2, "t2");
      const third = await judgePage(3, "t4");

      // Three pages, three reads: the second and third were read ahead and
      // taken, not read again.
      expect(reads.map((read) => read.after)).toEqual(["t1", "t3", "t5"]);
      expect(rowSource.keys).toHaveBeenCalledTimes(3);
      expect(second).toMatchObject({
        rows: 2,
        cursor: "t4",
        hasNextPage: true,
      });
      expect(third).toMatchObject({
        rows: 1,
        cursor: "t5",
        hasNextPage: false,
      });
      expect(inserted.flat().map((record) => record.TraceId)).toEqual([
        "t1",
        "t2",
        "t3",
        "t4",
        "t5",
      ]);
    });
  });

  describe("when the intent that arrives asks for a different page", () => {
    it("reads that page itself and drops what was read ahead", async () => {
      const classifier = new GatedNullClassifier();
      classifier.open();
      const { rowSource, reads, judgePage } = harness({ classifier });

      await judgePage(1, null);
      // A redelivery of page one, not page two: the prefetch does not fit.
      await judgePage(1, null);

      expect(reads.map((read) => read.after)).toEqual(["t1", "t3", "t1", "t3"]);
      expect(rowSource.keys).toHaveBeenCalledTimes(4);
    });
  });

  describe("when the run is cancelled between pages", () => {
    /** @scenario "A cancelled run stops between pages" */
    it("judges nothing and drops the page read ahead", async () => {
      const classifier = new GatedNullClassifier();
      classifier.open();
      let cancelled = false;
      const { rowSource, reads, judgePage } = harness({
        classifier,
        isCancelled: async () => cancelled,
      });

      await judgePage(1, null);
      cancelled = true;
      const outcome = await judgePage(2, "t2");

      expect(outcome).toMatchObject({
        rows: 0,
        cursor: null,
        hasNextPage: false,
      });
      expect(rowSource.judgePrepared).toHaveBeenCalledTimes(1);

      // Un-cancelled and asked again, the page is read afresh: nothing from
      // before the cancel is reused.
      cancelled = false;
      await judgePage(2, "t2");
      expect(reads.map((read) => read.after)).toEqual(["t1", "t3", "t3", "t5"]);
    });
  });

  describe("when a page fails", () => {
    /** @scenario "A page that mostly failed is thrown so the queue delivers it again" */
    it("drops the page read ahead so the retry reads for itself", async () => {
      const classifier = new GatedNullClassifier();
      classifier.open();
      const { rowSource, reads, judgePage } = harness({ classifier });
      (
        rowSource.judgePrepared as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error("judge unavailable"));

      await expect(judgePage(1, null)).rejects.toThrow("judge unavailable");
      await judgePage(1, null);

      expect(reads.map((read) => read.after)).toEqual(["t1", "t3", "t1", "t3"]);
    });
  });
});
