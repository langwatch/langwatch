/**
 * The stub builders and inputs the search-router tests share.
 * Not a test file: it holds no assertions, only the world the tests beside it
 * put the router in.
 */

import type { Authorization } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import type { RouteSearchInput } from "@langwatch/trace-contract";
import { vi, type Mock } from "vitest";

import { ownProof } from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceSearchRouterDeps } from "../trace-search-router.service.ts";

/** The proof the route minted; every builder receives it alongside the project. */
export const PROOF = ownProof({ projectId: "project-1" });

export const RANGE = { from: 1_000_000, to: 1_000_000 + 24 * 3_600_000 };

export const input = (
  overrides: Partial<RouteSearchInput> = {},
): RouteSearchInput & { authorization: Authorization } => ({
  projectId: "project-1",
  authorization: PROOF,
  text: "annoyed users",
  timeRange: RANGE,
  activeQuery: "",
  ...overrides,
});

export class ProviderDisabled extends HandledError {
  declare readonly code: "model_provider_disabled";
  constructor() {
    super("model_provider_disabled", "The model's provider is disabled.", { httpStatus: 400 });
  }
}

export class NoModel extends HandledError {
  declare readonly code: "model_not_configured";
  constructor() {
    super("model_not_configured", "No model configured.", { httpStatus: 400 });
  }
}

/** A provider that answered with a failure, which carries its code. */
export class ProviderError extends HandledError {
  declare readonly code: "ai_query_provider_error";
  constructor() {
    super("ai_query_provider_error", "The model provider failed.", {
      httpStatus: 502,
    });
  }
}

export function deps(
  overrides: Partial<Omit<TraceSearchRouterDeps, "recordDecision">> = {},
): TraceSearchRouterDeps & { recordDecision: Mock<TraceSearchRouterDeps["recordDecision"]> } {
  return {
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
    recordDecision: vi.fn<TraceSearchRouterDeps["recordDecision"]>(),
    ...overrides,
  };
}
