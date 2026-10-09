/**
 * A search-bar sentence classified before trace routes it: the release read,
 * the project's known signals, then one classification. Every read fails soft,
 * so the browser always gets an answer to route with (T2 D3, 2026-10-08).
 * @see specs/traces-v2/instant-eval-search.feature
 */

import type {
  ExplorerSearchClassification,
  ExplorerSearchClassificationInput,
} from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";
import {
  splitBareWords,
  type FacetValuesResult,
  type KnownProjectSignals,
  type TraceApi,
} from "@langwatch/trace-contract";

import {
  buildRouteContext,
  buildRouteQuestion,
  KNOWN_SIGNALS_LIMIT,
  routeAnswerOf,
} from "../rules/instant-eval-search-route.rules.ts";
import type { InstantEvalClassifyService } from "./instant-eval-classify.service.ts";

const logger = createLogger("langwatch:instant-eval:classify-search");

/** What the classification reads beyond the judge. */
interface InstantEvalClassifySearchPeers {
  /** Whether Instant Evals are released for the project (the flag alone). */
  isReleased(input: { projectId: string }): Promise<boolean>;
  /** The trace facets the known evaluator and event names are read from. */
  traces: Pick<TraceApi, "readFacetValues">;
}

export class InstantEvalClassifySearchService {
  private constructor(
    private readonly classifications: Pick<InstantEvalClassifyService, "classify">,
    private readonly peers: InstantEvalClassifySearchPeers,
  ) {}

  static create({
    classifications,
    peers,
  }: {
    classifications: Pick<InstantEvalClassifyService, "classify">;
    peers: InstantEvalClassifySearchPeers;
  }): InstantEvalClassifySearchService {
    return new InstantEvalClassifySearchService(classifications, peers);
  }

  async classifySearch(
    input: ExplorerSearchClassificationInput,
  ): Promise<ExplorerSearchClassification> {
    const { sentence, explicitQuery } = splitBareWords(input.text);
    const isInstantEvalAvailable = await this.#isReleased(input);
    if (!sentence) return { classified: null, isInstantEvalAvailable };
    const known = await this.#knownSignals(input);
    const question = buildRouteQuestion({
      isLangyAvailable: input.isLangyAvailable ?? true,
      isInstantEvalAvailable,
    });
    try {
      const judgement = await this.classifications.classify({
        projectId: input.projectId,
        text: buildRouteContext({
          sentence,
          explicitQuery,
          activeQuery: input.activeQuery ?? "",
          ...(input.lensId === void 0 ? {} : { lensId: input.lensId }),
          timeRange: input.timeRange,
          known,
        }),
        questions: [question],
      });
      const answer = routeAnswerOf({ judgement, question });
      const classified = answer.kind === "routed" ? answer.route : null;
      if (classified === null) {
        logger.info(
          { projectId: input.projectId, skippedReason: judgement.skippedReason },
          "Classifier did not route the search",
        );
      }
      return { classified, isInstantEvalAvailable };
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, err: error },
        "Classifier failed to route the search",
      );
      return { classified: null, isInstantEvalAvailable };
    }
  }

  /** The flag read, failing closed: an unreadable flag offers no judgement. */
  async #isReleased({ projectId }: { projectId: string }): Promise<boolean> {
    try {
      return await this.peers.isReleased({ projectId });
    } catch (error) {
      logger.warn({ projectId, err: error }, "Instant Evals release could not be read");
      return false;
    }
  }

  /** Evaluator and event names in the window; a facet that fails lists none. */
  async #knownSignals({
    projectId,
    timeRange,
  }: ExplorerSearchClassificationInput): Promise<KnownProjectSignals> {
    const [evaluators, events] = await Promise.allSettled(
      ["evaluator", "event"].map((facetKey) =>
        this.peers.traces.readFacetValues({
          tenantId: projectId,
          timeRange,
          facetKey,
          limit: KNOWN_SIGNALS_LIMIT,
          offset: 0,
        }),
      ),
    );
    const names = (settled?: PromiseSettledResult<FacetValuesResult>): string[] =>
      settled?.status === "fulfilled" ? settled.value.values.map((entry) => entry.value) : [];
    return { evaluators: names(evaluators), events: names(events) };
  }
}
