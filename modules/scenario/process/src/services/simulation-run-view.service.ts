import { NotFoundError } from "@langwatch/handled-error";
import {
  BatchRunNotFoundError,
  SimulationRunNotFoundError,
  type ScenarioRunData,
  type SimulationBatchSummaryRest,
  type SimulationRunData,
  type SimulationRunListInput,
  type SimulationRunListResponse,
  type SimulationRunLookupInput,
  type SimulationRunRestResponse,
  type SimulationScenarioRunInput,
  type SimulationService,
} from "@langwatch/scenario-contract";

import { toBatchSummaryResponse } from "../rules/simulation-batch-summary.rules.ts";
import type { ScenarioPlatformLinkService } from "./scenario-platform-link.service.ts";

/** The runs and batches a simulation produced, as the run drawer and the public API read them. */
export class SimulationRunViewService {
  static create(input: {
    simulations: SimulationService;
    platformLinks: ScenarioPlatformLinkService;
  }): SimulationRunViewService {
    return new SimulationRunViewService(input);
  }

  readonly #simulations: SimulationService;
  readonly #platformLinks: ScenarioPlatformLinkService;

  private constructor(input: {
    simulations: SimulationService;
    platformLinks: ScenarioPlatformLinkService;
  }) {
    this.#simulations = input.simulations;
    this.#platformLinks = input.platformLinks;
  }

  /** A point lookup by unique run id, with no window, so old runs stay reachable. */
  async getRunState(input: SimulationScenarioRunInput): Promise<SimulationRunData> {
    const data = await this.#simulations.findScenarioRunData(input);
    if (!data) throw new NotFoundError("not_found", "Scenario run", input.scenarioRunId);
    return data;
  }

  async listRuns(input: SimulationRunListInput): Promise<SimulationRunListResponse> {
    const { projectId, projectSlug, scenarioSetId, batchRunId, limit, cursor, include } = input;
    if (batchRunId) {
      return this.#batchRuns({ projectId, projectSlug, scenarioSetId, batchRunId });
    }

    if (scenarioSetId) {
      const result = await this.#simulations.getRunDataForScenarioSet({
        projectId,
        scenarioSetId,
        limit,
        cursor,
        shouldIncludeMessages: include === "messages",
      });
      return {
        runs: await this.#withPlatformUrls({ runs: result.runs, projectId, projectSlug }),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor ?? undefined,
      };
    }

    const result = await this.#simulations.getRunDataForAllSuites({
      projectId,
      limit,
      cursor,
      shouldIncludeMessages: include === "messages",
    });
    if (!result.changed) return { runs: [], hasMore: false };

    return {
      runs: await this.#withPlatformUrls({ runs: result.runs, projectId, projectSlug }),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
  }

  async getRun(input: SimulationRunLookupInput): Promise<SimulationRunRestResponse> {
    const run = await this.#simulations.findScenarioRunData({
      projectId: input.projectId,
      scenarioRunId: input.scenarioRunId,
    });
    if (!run) throw new SimulationRunNotFoundError(input.scenarioRunId);

    return this.#withPlatformUrl({
      run,
      projectId: input.projectId,
      projectSlug: input.projectSlug,
    });
  }

  async getBatchSummary(input: {
    projectId: string;
    batchRunId: string;
  }): Promise<SimulationBatchSummaryRest> {
    const batch = await this.#simulations.findBatchSummary(input);
    if (!batch) throw new BatchRunNotFoundError(input.batchRunId);

    return toBatchSummaryResponse(batch);
  }

  /**
   * The scenario set id narrows the query when given, but the batch id alone is
   * enough: the CLI's --wait polls with just the batch id it was handed at scheduling time.
   */
  async #batchRuns(input: {
    projectId: string;
    projectSlug: string;
    scenarioSetId: string | undefined;
    batchRunId: string;
  }): Promise<SimulationRunListResponse> {
    const result = await this.#simulations.getRunDataForBatchRun({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      batchRunId: input.batchRunId,
    });
    if ("changed" in result && result.changed === false) {
      return { runs: [], hasMore: false };
    }

    const runs = "runs" in result ? result.runs : [];
    return { runs: await this.#withPlatformUrls({ ...input, runs }), hasMore: false };
  }

  #withPlatformUrls(input: {
    runs: readonly ScenarioRunData[];
    projectId: string;
    projectSlug: string;
  }): Promise<SimulationRunRestResponse[]> {
    return Promise.all(input.runs.map((run) => this.#withPlatformUrl({ ...input, run })));
  }

  /** Main's `scenarioRunPlatformUrl`: the run detail drawer, in the interface the project reads. */
  async #withPlatformUrl(input: {
    run: ScenarioRunData;
    projectId: string;
    projectSlug: string;
  }): Promise<SimulationRunRestResponse> {
    return {
      ...toRunResponse(input.run),
      platformUrl: await this.#platformLinks.resourceUrl({
        projectId: input.projectId,
        projectSlug: input.projectSlug,
        resource: { scenarioRunId: input.run.scenarioRunId },
      }),
    };
  }
}

/**
 * The API's view of one run. The published fields are mapped one by one off
 * the run's metadata, and the metadata itself stays out of the response.
 */
function toRunResponse(run: ScenarioRunData): Omit<SimulationRunRestResponse, "platformUrl"> {
  const { metadata, results, messages, ...rest } = run;
  return {
    ...rest,
    name: run.name ?? null,
    description: run.description ?? null,
    results: results ?? null,
    updatedAt: run.updatedAt ?? run.timestamp,
    messages: messages.map((m) => ({
      role: typeof m.role === "string" ? m.role : "",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
    })),
    note: metadata?.note ?? null,
    scenarioVersion: metadata?.langwatch?.scenarioVersion ?? null,
  };
}
