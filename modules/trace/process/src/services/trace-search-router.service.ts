/**
 * Where a typed search goes when Enter is pressed on a sentence: a filter, a
 * judgement, a phrase, or a question for the assistant. Every dependency
 * arrives through {@link TraceSearchRouterDeps}. @see ADR-144
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  combineQueries,
  parse,
  quoteAsPhrase,
  splitBareWords,
  type AiActionResult,
  type InstantEvalQuestionResult,
  type InstantEvalSearchTarget,
  type KnownProjectSignals,
  type RouteSearchAvailability,
  type RouteSearchInput,
  type RouteSearchResult,
  type SearchRouteDecidedBy,
  type SearchRouteKind,
  CONVERSATIONS_LENS_ID,
} from "@langwatch/trace-contract";

import {
  buildRouteContext,
  buildRouteQuestion,
  isRouteKind,
  ROUTE_QUESTION_ID,
  type TraceSearchRouteQuestion,
} from "../rules/trace-search-classifier-context.rules.ts";

const logger = createLogger("langwatch:traces:search-router");

/** One question's answer, as the router reads it. */
export interface TraceSearchVerdict {
  readonly questionId: string;
  readonly label?: string;
}

/** What one classification answered, whether or not it answered. */
export interface TraceSearchClassification {
  readonly verdicts: readonly TraceSearchVerdict[];
  readonly skippedReason?: string;
}

/** One text, judged against the questions asked about it. */
export interface TraceSearchClassifyRequest {
  projectId: string;
  text: string;
  questions: readonly TraceSearchRouteQuestion[];
}

/**
 * The judge the router asks, declared here rather than imported: the
 * classifier is another module's, and the composition supplies it.
 */
export interface TraceSearchClassifier {
  classify(request: TraceSearchClassifyRequest): Promise<TraceSearchClassification>;
}

/** Where a sentence goes when the classifier is not there to say. */
export type SearchRouteDecision =
  | { route: "filter"; query: string }
  | { route: "instant_eval"; instructions: string; criteria: [string, string] }
  | { route: "free_text" }
  | { route: "langy" };

export interface TraceSearchRouterDeps {
  /** The classifier, or null when the deployment has none. */
  classifier: TraceSearchClassifier | null;
  /** Builds a filter from a sentence (the Ask AI composer's own builder). */
  buildFilter: (input: {
    projectId: string;
    prompt: string;
    timeRange: { from: number; to: number };
  }) => Promise<AiActionResult>;
  /** Rewrites a sentence into a judge question, or an existing-signal filter. */
  buildQuestion: (input: {
    projectId: string;
    text: string;
    target: InstantEvalSearchTarget;
    known: KnownProjectSignals;
  }) => Promise<InstantEvalQuestionResult>;
  /** Decides and builds in one model call, when there is no classifier. */
  routeWithModel: (input: {
    projectId: string;
    text: string;
    timeRange: { from: number; to: number };
    target: InstantEvalSearchTarget;
    known: KnownProjectSignals;
    isLangyAvailable: boolean;
    isInstantEvalAvailable: boolean;
  }) => Promise<SearchRouteDecision>;
  /** Evaluator and event names on the project, for the context line. */
  listKnownSignals: (input: {
    projectId: string;
    timeRange: { from: number; to: number };
  }) => Promise<KnownProjectSignals>;
  /** Whether Instant Evals are released for the project (the flag alone). */
  isInstantEvalReleased: (input: { projectId: string }) => Promise<boolean>;
  /** Counts a decision. Never metered. */
  recordDecision: (decision: { route: SearchRouteKind; decidedBy: SearchRouteDecidedBy }) => void;
}

/** The sentence and the explicit terms as one shared context for the routes. */
interface RouteContext {
  input: RouteSearchInput;
  sentence: string;
  explicitQuery: string;
  target: InstantEvalSearchTarget;
  known: KnownProjectSignals;
  available: RouteSearchAvailability;
}

/**
 * The codes model resolution fails with when the project has no model to
 * call: none set at any scope, or one set whose provider is switched off.
 */
const MODEL_UNAVAILABLE_CODES: readonly string[] = [
  "model_not_configured",
  "model_provider_disabled",
];

function isModelUnavailableError(error: unknown): boolean {
  return error instanceof HandledError && MODEL_UNAVAILABLE_CODES.includes(error.code);
}

/** A query the language parses, or not. */
function parses(query: string): boolean {
  try {
    parse(query);
    return true;
  } catch {
    return false;
  }
}

function phraseSearch({ sentence, explicitQuery }: RouteContext): string {
  return combineQueries({ base: explicitQuery, addition: quoteAsPhrase(sentence) });
}

export class TraceSearchRouterService {
  private constructor(private readonly deps: TraceSearchRouterDeps) {}

  static create(deps: TraceSearchRouterDeps): TraceSearchRouterService {
    return new TraceSearchRouterService(deps);
  }

  async route(input: RouteSearchInput): Promise<RouteSearchResult> {
    const { sentence, explicitQuery } = splitBareWords(input.text);
    if (!sentence) {
      this.deps.recordDecision({ route: "filter", decidedBy: "fallback" });
      return { kind: "filter", query: explicitQuery, decidedBy: "fallback" };
    }
    const [known, isInstantEvalAvailable] = await Promise.all([
      this.knownSignals(input),
      this.instantEvalReleased(input),
    ]);
    const context: RouteContext = {
      input,
      sentence,
      explicitQuery,
      target: input.lensId === CONVERSATIONS_LENS_ID ? "threads" : "traces",
      known,
      available: { isLangyAvailable: input.isLangyAvailable ?? true, isInstantEvalAvailable },
    };
    if (input.forceKind) {
      return this.applyClassified({ context, classified: input.forceKind, decidedBy: "caller" });
    }
    const classified = await this.classify(context);
    if (classified) {
      return this.applyClassified({ context, classified, decidedBy: "classifier" });
    }
    return this.routeWithModel(context);
  }

  /** The classifier's answer, or null when it had none and the model decides. */
  private async classify(context: RouteContext): Promise<SearchRouteKind | null> {
    const { input } = context;
    if (!this.deps.classifier) return null;
    try {
      const judgement = await this.deps.classifier.classify({
        projectId: input.projectId,
        text: buildRouteContext({
          sentence: context.sentence,
          explicitQuery: context.explicitQuery,
          activeQuery: input.activeQuery,
          ...(input.lensId === void 0 ? {} : { lensId: input.lensId }),
          timeRange: input.timeRange,
          known: context.known,
        }),
        questions: [buildRouteQuestion(context.available)],
      });
      const label = judgement.verdicts.find(
        (candidate) => candidate.questionId === ROUTE_QUESTION_ID,
      )?.label;
      if (judgement.skippedReason !== void 0 || !isRouteKind(label)) {
        logger.info(
          { projectId: input.projectId, skippedReason: judgement.skippedReason },
          "Classifier did not route the search; the model decides",
        );
        return null;
      }
      return label;
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, err: error },
        "Classifier failed to route the search; the model decides",
      );
      return null;
    }
  }

  private async applyClassified({
    context,
    classified,
    decidedBy,
  }: {
    context: RouteContext;
    classified: SearchRouteKind;
    decidedBy: SearchRouteDecidedBy;
  }): Promise<RouteSearchResult> {
    switch (classified) {
      case "filter":
        return this.buildFilterRoute({ context, decidedBy });
      case "instant_eval":
        // The option is not offered while Instant Evals are unreleased; an
        // answer naming it anyway is searched as a filter, which falls to the
        // phrase on its own when the model cannot write one.
        return context.available.isInstantEvalAvailable
          ? this.buildInstantEvalRoute({ context, decidedBy })
          : this.buildFilterRoute({ context, decidedBy });
      case "free_text":
        return this.freeText({ context, decidedBy });
      case "langy":
        return this.langy({ context, decidedBy });
    }
  }

  /** The model both decides and builds when the classifier had no answer. */
  private async routeWithModel(context: RouteContext): Promise<RouteSearchResult> {
    const { input } = context;
    let decision: SearchRouteDecision;
    try {
      decision = await this.deps.routeWithModel({
        projectId: input.projectId,
        text: context.sentence,
        timeRange: input.timeRange,
        target: context.target,
        known: context.known,
        ...context.available,
      });
    } catch (error) {
      const isModelUnavailable = isModelUnavailableError(error);
      if (!isModelUnavailable) {
        logger.warn(
          { projectId: input.projectId, err: error },
          "Model could not route the search; searching the phrase instead",
        );
      }
      return this.freeText({
        context,
        decidedBy: "fallback",
        isModelUnavailable,
        fellBackFrom: "routing",
      });
    }
    const decidedBy = "model";
    switch (decision.route) {
      case "filter":
        return this.finishFilter({ context, generated: decision.query, decidedBy });
      case "instant_eval":
        return context.available.isInstantEvalAvailable
          ? this.instantEval({
              context,
              question: { instructions: decision.instructions, criteria: decision.criteria },
              decidedBy,
            })
          : this.freeText({ context, decidedBy });
      case "langy":
        return this.langy({ context, decidedBy });
      case "free_text":
        return this.freeText({ context, decidedBy });
    }
  }

  private freeText({
    context,
    decidedBy,
    isModelUnavailable = false,
    fellBackFrom,
  }: {
    context: RouteContext;
    decidedBy: SearchRouteDecidedBy;
    isModelUnavailable?: boolean;
    fellBackFrom?: SearchRouteKind | "routing";
  }): RouteSearchResult {
    this.deps.recordDecision({ route: "free_text", decidedBy });
    return {
      kind: "free_text",
      query: phraseSearch(context),
      decidedBy,
      isModelUnavailable,
      ...(fellBackFrom ? { fellBackFrom } : {}),
    };
  }

  private finishFilter({
    context,
    generated,
    decidedBy,
    explanation,
  }: {
    context: RouteContext;
    generated: string;
    decidedBy: SearchRouteDecidedBy;
    explanation?: string;
  }): RouteSearchResult {
    // The model's own escape hatch for a sentence it could not express.
    if (!generated.trim()) {
      return this.freeText({ context, decidedBy: "fallback", fellBackFrom: "filter" });
    }
    const merged = combineQueries({ base: context.explicitQuery, addition: generated });
    const query = parses(merged) ? merged : generated;
    this.deps.recordDecision({ route: "filter", decidedBy });
    return { kind: "filter", query, decidedBy, ...(explanation ? { explanation } : {}) };
  }

  private instantEval({
    context,
    question,
    decidedBy,
  }: {
    context: RouteContext;
    question: { instructions: string; criteria: [string, string] };
    decidedBy: SearchRouteDecidedBy;
  }): RouteSearchResult {
    this.deps.recordDecision({ route: "instant_eval", decidedBy });
    return {
      kind: "instant_eval",
      question,
      target: context.target,
      otherQuery: context.explicitQuery,
      fallbackQuery: phraseSearch(context),
      decidedBy,
    };
  }

  private langy({
    context,
    decidedBy,
  }: {
    context: RouteContext;
    decidedBy: SearchRouteDecidedBy;
  }): RouteSearchResult {
    this.deps.recordDecision({ route: "langy", decidedBy });
    return { kind: "langy", question: context.input.text, decidedBy };
  }

  private async buildFilterRoute({
    context,
    decidedBy,
  }: {
    context: RouteContext;
    decidedBy: SearchRouteDecidedBy;
  }): Promise<RouteSearchResult> {
    let built: AiActionResult;
    try {
      built = await this.deps.buildFilter({
        projectId: context.input.projectId,
        prompt: context.sentence,
        timeRange: context.input.timeRange,
      });
    } catch (error) {
      logger.warn(
        { projectId: context.input.projectId, err: error },
        "Filter route could not be built; searching the phrase instead",
      );
      return this.freeText({
        context,
        decidedBy: "fallback",
        isModelUnavailable: isModelUnavailableError(error),
        fellBackFrom: "filter",
      });
    }
    return this.finishFilter({ context, generated: built.query, decidedBy });
  }

  private async buildInstantEvalRoute({
    context,
    decidedBy,
  }: {
    context: RouteContext;
    decidedBy: SearchRouteDecidedBy;
  }): Promise<RouteSearchResult> {
    let built: InstantEvalQuestionResult;
    try {
      built = await this.deps.buildQuestion({
        projectId: context.input.projectId,
        text: context.sentence,
        target: context.target,
        known: context.known,
      });
    } catch (error) {
      logger.warn(
        { projectId: context.input.projectId, err: error },
        "Instant Eval question could not be written; searching the phrase instead",
      );
      return this.freeText({
        context,
        decidedBy: "fallback",
        isModelUnavailable: isModelUnavailableError(error),
        fellBackFrom: "instant_eval",
      });
    }
    if (built.kind === "filter") {
      return this.finishFilter({
        context,
        generated: built.query,
        decidedBy,
        explanation: built.reason,
      });
    }
    return this.instantEval({
      context,
      question: { instructions: built.instructions, criteria: built.criteria },
      decidedBy,
    });
  }

  /** The flag read, failing closed: an unreadable flag offers no judgement. */
  private async instantEvalReleased(input: RouteSearchInput): Promise<boolean> {
    try {
      return await this.deps.isInstantEvalReleased({ projectId: input.projectId });
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, err: error },
        "Instant Evals release could not be read; routing without the judgement route",
      );
      return false;
    }
  }

  private async knownSignals(input: RouteSearchInput): Promise<KnownProjectSignals> {
    try {
      return await this.deps.listKnownSignals({
        projectId: input.projectId,
        timeRange: input.timeRange,
      });
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, err: error },
        "Known evaluators and events could not be listed; routing without them",
      );
      return { evaluators: [], events: [] };
    }
  }
}
