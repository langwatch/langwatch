/**
 * A filter picker under an aggregate's proof holds each evaluation to its trace's window
 * (ADR-177 v4.15); a plain project's picker reads as before.
 */
import type { Authorization } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../repositories/__tests__/analytics-proof.fixture.ts";
import {
  FilterOptionsRepository,
  type FilterOption,
  type FindFilterOptionsInput,
} from "../../repositories/filter-options.repository.ts";
import { FilterService } from "../filter.service.ts";

/** Records what the service asked the repository for. */
class RecordingFilterOptionsRepository extends FilterOptionsRepository {
  readonly asked: FindFilterOptionsInput[] = [];

  findOptions(input: FindFilterOptionsInput): Promise<FilterOption[]> {
    this.asked.push(input);
    return Promise.resolve([]);
  }
}

async function askedFor(authorization: Authorization): Promise<FindFilterOptionsInput> {
  const repository = new RecordingFilterOptionsRepository();
  await FilterService.create({ repository }).getFilterOptions({
    projectId: "project-own",
    field: "evaluations.evaluator_id",
    startDate: 0,
    endDate: 1,
    authorization,
  });
  const [input] = repository.asked;
  if (!input) throw new Error("the repository was never asked");
  return input;
}

describe("FilterService.getFilterOptions", () => {
  describe("given an aggregate's proof that reads member projects", () => {
    it("asks for options read through each member's window", async () => {
      const proof = analyticsProof({
        projectId: "project-own",
        shared: [{ projectId: "project-member", from: 1_000 }],
      });

      expect((await askedFor(proof)).readsMembers).toBe(true);
    });
  });

  describe("given a plain project's proof", () => {
    it("asks for options as before", async () => {
      const proof = analyticsProof({ projectId: "project-own" });

      expect((await askedFor(proof)).readsMembers).toBe(false);
    });
  });
});
