/**
 * The stub classifier, stub builders and inputs the search-router tests share.
 *
 * Not a test file: it holds no assertions, only the world the three test
 * files below it put the router in.
 *
 * @see ./route-search.unit.test.ts
 * @see ./route-search.fallbacks.unit.test.ts
 * @see ./classifier-context.unit.test.ts
 */
import { HandledError } from "@langwatch/handled-error";
import { type Mock, vi } from "vitest";
import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgement,
} from "~/server/app-layer/instant-evals/classifier/classifier";
import type {
  RouteSearchInput,
  SearchRouteKind,
  SearchRouterDeps,
} from "../contracts";

export const RANGE = { from: 1_000_000, to: 1_000_000 + 24 * 3_600_000 };

export const input = (
  overrides: Partial<RouteSearchInput> = {},
): RouteSearchInput => ({
  projectId: "project-1",
  text: "annoyed users",
  timeRange: RANGE,
  activeQuery: "",
  ...overrides,
});

export function answering(label: SearchRouteKind | null) {
  const classify = vi.fn(
    async (
      _request: InstantEvalClassifyRequest,
    ): Promise<InstantEvalJudgement> =>
      label
        ? {
            verdicts: [{ questionId: "route", label }],
            inputTokens: 120,
            isTextTruncated: false,
          }
        : {
            verdicts: [],
            skippedReason: "classifier_rate_limited",
            inputTokens: 0,
            isTextTruncated: false,
          },
  );
  return { classify };
}

export class ProviderDisabled extends HandledError {
  declare readonly code: "model_provider_disabled";
  constructor() {
    super("model_provider_disabled", "The model's provider is disabled.", {
      httpStatus: 400,
    });
  }
}

export class NoModel extends HandledError {
  declare readonly code: "model_not_configured";
  constructor() {
    super("model_not_configured", "No model configured.", { httpStatus: 400 });
  }
}

export function deps(
  overrides: Partial<Omit<SearchRouterDeps, "recordDecision">> = {},
): SearchRouterDeps & {
  recordDecision: Mock<SearchRouterDeps["recordDecision"]>;
} {
  return {
    classifier: null,
    buildFilter: vi.fn(async () => ({
      ok: true as const,
      kind: "apply_query" as const,
      query: "status:error",
    })),
    buildQuestion: vi.fn(async () => ({
      kind: "question" as const,
      instructions: "Does the user sound annoyed?",
      criteria: ["Complains or repeats", "Stays neutral"] as [string, string],
    })),
    routeWithModel: vi.fn(async () => ({ route: "free_text" as const })),
    listKnownSignals: vi.fn(async () => ({
      evaluators: ["ragas/faithfulness"],
      events: ["thumbs_up_down"],
    })),
    isInstantEvalReleased: vi.fn(async () => true),
    recordDecision: vi.fn<SearchRouterDeps["recordDecision"]>(),
    ...overrides,
  };
}
