/**
 * Planning a run: the count that bounds it, the cap that says so, and the page
 * size a spread of its own texts chooses.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type { LangWatchQLColumn } from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { instantEvalRunRow } from "../../__tests__/instant-eval.fixtures.ts";
import { MemoryInstantEvalRunRepository } from "../../repositories/memory/memory.instant-eval-run.repository.ts";
import type { InstantEvalRowKey } from "../../rules/instant-eval-row-keys.rules.ts";
import type { InstantEvalTextSource } from "../instant-eval-estimate.service.ts";
import { InstantEvalPlanService } from "../instant-eval-plan.service.ts";
import type { InstantEvalRowSourceService } from "../instant-eval-row-source.service.ts";
import { InstantEvalRunContextService } from "../instant-eval-run-context.service.ts";

const PROJECT_ID = "project-1";
const RUN_ID = "run-1";
const AT = Temporal.Instant.from("2026-09-18T10:00:00Z");
const PROTECTIONS = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as const;

const QUESTION = {
  id: "annoyed",
  function: "eval_boolean",
  kind: "boolean",
  reads: "probability",
  question: { id: "annoyed", kind: "boolean" },
};

function column(name: string): LangWatchQLColumn {
  return { name, type: "String" };
}

/** The passes a plan runs, each answering one fixed result and recording the ask. */
class ScriptedRowSource implements Pick<
  InstantEvalRowSourceService,
  "probe" | "count" | "sampleKeys"
> {
  readonly counted: { limit: number }[] = [];
  readonly sampled: { limit: number; total: number }[] = [];

  constructor(
    private readonly answers: {
      columns: readonly LangWatchQLColumn[];
      total: number;
      keys: readonly InstantEvalRowKey[];
    },
  ) {}

  async probe(): Promise<readonly LangWatchQLColumn[]> {
    return this.answers.columns;
  }

  async count(input: { limit: number }): Promise<number> {
    this.counted.push({ limit: input.limit });

    return this.answers.total;
  }

  async sampleKeys(input: { limit: number; total: number }): Promise<readonly InstantEvalRowKey[]> {
    this.sampled.push({ limit: input.limit, total: input.total });

    return this.answers.keys;
  }
}

/** The extraction half, answering one text per trace it was asked about. */
class ScriptedTexts implements InstantEvalTextSource {
  readonly asked: { traceIds: readonly string[] }[] = [];

  constructor(private readonly bytesPerRow: number) {}

  async texts(input: { traceIds: readonly string[] }): Promise<readonly Record<string, unknown>[]> {
    this.asked.push({ traceIds: input.traceIds });

    return input.traceIds.map(() => ({ annoyed: "x".repeat(this.bytesPerRow) }));
  }
}

function rowKey(traceId: string): InstantEvalRowKey {
  return { traceId, threadId: "", spanId: "", occurredAt: null };
}

async function planning({
  total,
  rowLimit = 10_000,
  bytesPerRow = 200,
  keyCap = 500,
  columns = [column("TraceId")],
}: {
  total: number;
  rowLimit?: number;
  bytesPerRow?: number;
  keyCap?: number;
  columns?: readonly LangWatchQLColumn[];
}): Promise<{
  service: InstantEvalPlanService;
  rowSource: ScriptedRowSource;
  texts: ScriptedTexts;
}> {
  const runs = MemoryInstantEvalRunRepository.create(() => AT);
  await runs.write(
    instantEvalRunRow({ id: RUN_ID, projectId: PROJECT_ID, rowLimit, questions: [QUESTION] }),
  );
  const rowSource = new ScriptedRowSource({
    columns,
    total,
    keys: [rowKey("t1"), rowKey("t2")],
  });
  const texts = new ScriptedTexts(bytesPerRow);

  return {
    service: InstantEvalPlanService.create({
      context: InstantEvalRunContextService.create({
        runs,
        peers: {
          findProjectCaller: async () => ({ id: PROJECT_ID, lwqlKey: "key-1" }),
          resolveProjectProtections: async () => PROTECTIONS,
          isQueryIdentityAvailable: () => true,
        },
      }),
      rowSource,
      textSource: texts,
      keyCaps: { langWatchQLKeyCapFor: () => keyCap },
    }),
    rowSource,
    texts,
  };
}

describe("given a run whose statement matches fewer rows than its limit", () => {
  describe("when it is planned", () => {
    /** @scenario "The run's total comes from a count rather than from every key" */
    it("counts one row past the limit so a capped run is recognisable", async () => {
      const { service, rowSource } = await planning({ total: 1_200, rowLimit: 10_000 });

      const plan = await service.plan({ projectId: PROJECT_ID, runId: RUN_ID });

      expect(rowSource.counted).toEqual([{ limit: 10_001 }]);
      expect(plan).toMatchObject({ total: 1_200, isCapped: false });
    });

    it("names the optional key columns the statement projects", async () => {
      const { service } = await planning({
        total: 10,
        columns: [column("TraceId"), column("ThreadId")],
      });

      const plan = await service.plan({ projectId: PROJECT_ID, runId: RUN_ID });

      expect(plan.keyColumns).toEqual(["ThreadId"]);
    });
  });
});

describe("given a run whose statement matches more rows than its limit", () => {
  describe("when it is planned", () => {
    it("bounds the total to the limit and reports the run capped", async () => {
      const { service } = await planning({ total: 1_001, rowLimit: 1_000 });

      const plan = await service.plan({ projectId: PROJECT_ID, runId: RUN_ID });

      expect(plan).toMatchObject({ total: 1_000, isCapped: true });
    });
  });
});

describe("given a run whose statement matches nothing", () => {
  describe("when it is planned", () => {
    it("reads no text, because there is nothing to size a page for", async () => {
      const { service, texts } = await planning({ total: 0 });

      const plan = await service.plan({ projectId: PROJECT_ID, runId: RUN_ID });

      expect(plan.total).toBe(0);
      expect(texts.asked).toEqual([]);
    });
  });
});

describe("given a selection of long texts", () => {
  describe("when the page size is chosen", () => {
    /** @scenario "A page of large texts is smaller than a page of small ones" */
    it("judges fewer rows per page than a selection of short ones", async () => {
      const large = await planning({ total: 5_000, bytesPerRow: 40 * 1024 });
      const small = await planning({ total: 5_000, bytesPerRow: 200 });

      const largePage = await large.service.plan({ projectId: PROJECT_ID, runId: RUN_ID });
      const smallPage = await small.service.plan({ projectId: PROJECT_ID, runId: RUN_ID });

      expect(largePage.pageSize).toBeLessThan(smallPage.pageSize);
    });

    /** @scenario "A page never exceeds the key cap of the statement's own functions" */
    it("never exceeds the key cap the statement's own functions carry", async () => {
      const { service } = await planning({ total: 5_000, bytesPerRow: 200, keyCap: 25 });

      const plan = await service.plan({ projectId: PROJECT_ID, runId: RUN_ID });

      expect(plan.pageSize).toBe(25);
    });
  });

  describe("when the sample is read", () => {
    it("spreads the sample across the selection rather than taking its head", async () => {
      const { service, rowSource } = await planning({ total: 5_000 });

      await service.plan({ projectId: PROJECT_ID, runId: RUN_ID });

      expect(rowSource.sampled).toEqual([{ limit: 50, total: 5_000 }]);
    });
  });
});
