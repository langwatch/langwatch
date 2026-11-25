/**
 * A search-bar sentence classified for trace's router: the context it is read
 * in, the routes it may be answered with, and every read failing soft.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { sealAuthorization, type Actor } from "@langwatch/authorization";
import type { ExplorerSearchClassificationInput } from "@langwatch/instant-eval-contract";
import type {
  InstantEvalCategoryQuestion,
  InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { FacetValuesResult, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { InstantEvalClassifySearchService } from "../instant-eval-classify-search.service.ts";
import type { InstantEvalClassifyService } from "../instant-eval-classify.service.ts";
import type { InstantEvalTraceProofService } from "../instant-eval-trace-proof.service.ts";

const DAY = { from: 0, to: 24 * 3_600_000 };

const ASKER = { type: "user", id: "user-1" } as const;
/** The traces:view proof AuthzApi.authorize mints for the asker (ruling TRACE-PROOF-EVAL-PERM). */
const PROOF = sealAuthorization({
  actor: ASKER,
  principal: ASKER,
  scope: { organizationId: "organization-1" },
  grants: [{ projectId: "project-1", permissions: ["traces:view"], via: [], kind: "own" }],
  expiresAt: Date.now() + 5 * 60 * 1000,
  purpose: { kind: "route", route: "instantEval.classifySearch" },
});

const INPUT: ExplorerSearchClassificationInput & { actor: Actor } = {
  projectId: "project-1",
  text: "frustrated users",
  timeRange: DAY,
  actor: ASKER,
};

function facet(...names: string[]): FacetValuesResult {
  return { values: names.map((value) => ({ value, count: 1 })), totalDistinct: names.length };
}

function answering(label: string): InstantEvalJudgement {
  return { verdicts: [{ questionId: "route", label }], inputTokens: 40, isTextTruncated: false };
}

function harness({
  released = async () => true,
  judgement = async () => answering("instant_eval"),
  readFacetValues = async ({ facetKey }) =>
    facetKey === "evaluator" ? facet("ragas/faithfulness") : facet("thumbs_up_down"),
  proof = async () => PROOF,
}: {
  released?: () => Promise<boolean>;
  judgement?: () => Promise<InstantEvalJudgement>;
  readFacetValues?: TraceApi["readFacetValues"];
  proof?: InstantEvalTraceProofService["mint"];
} = {}) {
  const classify = vi.fn<InstantEvalClassifyService["classify"]>(judgement);
  const facets = vi.fn<TraceApi["readFacetValues"]>(readFacetValues);
  const mints = vi.fn<InstantEvalTraceProofService["mint"]>(proof);
  const service = InstantEvalClassifySearchService.create({
    classifications: createApiFixture<Pick<InstantEvalClassifyService, "classify">>({ classify }),
    peers: {
      isReleased: released,
      traces: createApiFixture<Pick<TraceApi, "readFacetValues">>({ readFacetValues: facets }),
      proofs: { mint: mints },
    },
  });
  /** The one request the judge was sent. */
  const asked = () => {
    const request = classify.mock.calls.at(-1)?.[0];
    if (!request) throw new Error("the classifier was not asked");
    return {
      text: request.text,
      options: (request.questions[0] as InstantEvalCategoryQuestion).options.map(
        (option) => option.name,
      ),
    };
  };

  return { service, classify, facets, mints, asked };
}

describe("given a released project with known evaluators and events", () => {
  describe("when the browser asks to classify a sentence in its search context", () => {
    /** @scenario "The classifier reads the sentence next to the search's context" */
    it("reads the sentence next to the lens, window, filters, prior search and known signals", async () => {
      const { service, asked, facets } = harness();

      const answer = await service.classifySearch({
        ...INPUT,
        text: "frustrated users status:error",
        activeQuery: "model:gpt-5-mini",
        lensId: "conversations",
        isLangyAvailable: true,
      });

      expect(answer).toEqual({ classified: "instant_eval", isInstantEvalAvailable: true });
      expect(asked().text).toContain("Typed sentence: frustrated users");
      expect(asked().text).toContain("Lens: conversations. Time window: 24 hours.");
      expect(asked().text).toContain("Typed alongside it as filters: status:error");
      expect(asked().text).toContain("Search applied before this one: model:gpt-5-mini");
      expect(asked().text).toContain("Evaluators with results on this project: ragas/faithfulness");
      expect(asked().text).toContain("Event names on this project: thumbs_up_down");
      expect(asked().options).toEqual(["filter", "instant_eval", "free_text", "langy"]);
      expect(facets).toHaveBeenCalledWith({
        authorization: PROOF,
        timeRange: DAY,
        facetKey: "evaluator",
        limit: 20,
        offset: 0,
      });
    });
  });

  describe("when the browser says Langy is not open to the user", () => {
    /** @scenario "Without Langy the classifier is never offered langy" */
    it("offers filter, instant_eval and free_text, and not langy", async () => {
      const { service, asked } = harness({ judgement: async () => answering("langy") });

      const answer = await service.classifySearch({
        ...INPUT,
        text: "why did costs rise this week",
        isLangyAvailable: false,
      });

      expect(asked().options).toEqual(["filter", "instant_eval", "free_text"]);
      expect(answer.classified).toBeNull();
    });
  });
});

describe("given Instant Evals are not released for the project", () => {
  describe.each([
    ["not released", async () => false],
    [
      "unreadable",
      async (): Promise<boolean> => {
        throw new Error("flag store down");
      },
    ],
  ])("when the release is %s", (_case, released) => {
    /** @scenario "Instant Evals not released are neither offered nor reported available" */
    it("does not offer instant_eval and reports Instant Evals unavailable", async () => {
      const { service, asked } = harness({ released, judgement: async () => answering("filter") });

      const answer = await service.classifySearch(INPUT);

      expect(asked().options).not.toContain("instant_eval");
      expect(answer).toEqual({ classified: "filter", isInstantEvalAvailable: false });
    });
  });
});

describe("given a classifier with no route to answer", () => {
  describe.each([
    [
      "skips",
      async (): Promise<InstantEvalJudgement> => ({
        verdicts: [],
        skippedReason: "classifier_not_configured",
        inputTokens: 0,
        isTextTruncated: false,
      }),
    ],
    [
      "fails",
      async (): Promise<InstantEvalJudgement> => {
        throw new Error("judge unreachable");
      },
    ],
    ["answers a label that names no route", async () => answering("weather")],
  ])("when it %s", (_case, judgement) => {
    /** @scenario "A classifier that has no route answers no classification" */
    it("answers no classification and the release as read", async () => {
      const { service } = harness({ judgement });

      await expect(service.classifySearch(INPUT)).resolves.toEqual({
        classified: null,
        isInstantEvalAvailable: true,
      });
    });
  });
});

describe("given the project's evaluator and event names cannot be read", () => {
  describe("when the browser asks to classify a sentence", () => {
    /** @scenario "Known signals that cannot be read leave the context without them" */
    it("still asks the classifier, with no evaluators and no events in its context", async () => {
      const { service, asked } = harness({
        readFacetValues: async () => {
          throw new Error("clickhouse down");
        },
      });

      const answer = await service.classifySearch(INPUT);

      expect(answer.classified).toBe("instant_eval");
      expect(asked().text).toContain("Evaluators with results on this project: none");
      expect(asked().text).toContain("Event names on this project: none");
    });
  });
});

describe("given text with no sentence in it", () => {
  describe("when the browser asks to classify it", () => {
    /** @scenario "Text with no sentence asks the classifier nothing" */
    it("asks the classifier nothing and answers no classification", async () => {
      const { service, classify } = harness();

      const answer = await service.classifySearch({ ...INPUT, text: "status:error" });

      expect(answer).toEqual({ classified: null, isInstantEvalAvailable: true });
      expect(classify).not.toHaveBeenCalled();
    });
  });
});

describe("given an asker behind the analytics:view route", () => {
  describe("when the browser asks to classify a sentence", () => {
    it("reads both facets with the asker's traces:view proof", async () => {
      const { service, facets, mints } = harness();

      await service.classifySearch(INPUT);

      expect(mints).toHaveBeenCalledWith({
        projectId: "project-1",
        actor: ASKER,
        route: "instantEval.classifySearch",
      });
      expect(facets.mock.calls.map(([call]) => call.authorization)).toEqual([PROOF, PROOF]);
    });
  });

  describe("when authz refuses the asker traces:view", () => {
    it("still classifies, with no known signals and no facet read", async () => {
      const { service, facets, asked } = harness({
        proof: async () => {
          throw new Error("refused");
        },
      });

      const answer = await service.classifySearch(INPUT);

      expect(answer.classified).toBe("instant_eval");
      expect(asked().text).toContain("Evaluators with results on this project: none");
      expect(facets).not.toHaveBeenCalled();
    });
  });
});
