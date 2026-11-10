/**
 * A filter picker under an aggregate's proof holds each evaluation to its trace's window
 * (ADR-177 v4.15); a plain project's picker reads as before.
 */
import type { Authorization } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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

class FailingFilterOptionsRepository extends FilterOptionsRepository {
  constructor(private readonly failure: unknown) {
    super();
  }

  findOptions(): Promise<FilterOption[]> {
    return Promise.reject(this.failure);
  }
}

class TooManyQueriesInFlight extends HandledError {
  constructor() {
    super("clickhouse_overloaded", "Too many queries in flight", { httpStatus: 503 });
  }
}

function failingWith(failure: unknown) {
  const logged: { level: "error" | "warn"; fields: Record<string, unknown>; message: string }[] =
    [];
  const record =
    (level: "error" | "warn") =>
    (fields: unknown, message?: unknown): void => {
      logged.push({ level, fields: Object(fields), message: String(message) });
    };
  const logger = createApiFixture<Pick<Logger, "error" | "warn">>({
    error: record("error"),
    warn: record("warn"),
  });
  const service = FilterService.create({
    repository: new FailingFilterOptionsRepository(failure),
    logger,
  });
  const fetch = () =>
    service.getFilterOptions({
      projectId: "project-own",
      field: "spans.type",
      startDate: 0,
      endDate: 1,
      authorization: analyticsProof({ projectId: "project-own" }),
    });
  return { fetch, logged };
}

describe("FilterService.getFilterOptions when ClickHouse fails", () => {
  describe("given a raw ClickHouse error", () => {
    /** @scenario "A failed filter options read logs its cause" */
    it("logs the whole error and throws a generic one without the SQL", async () => {
      const timeout = Object.assign(new Error("Timeout error. SELECT ... FROM stored_spans"), {
        code: "159",
      });
      const { fetch, logged } = failingWith(timeout);

      await expect(fetch()).rejects.toThrow(/^Failed to fetch filter options$/);
      expect(logged).toEqual([
        {
          level: "error",
          fields: expect.objectContaining({ field: "spans.type", error: timeout }),
          message: "Failed to fetch filter options from ClickHouse",
        },
      ]);
    });
  });

  describe("given ClickHouse refused the read as overloaded", () => {
    /** @scenario "A failed filter options read logs its cause" */
    it("warns with the refusal and rethrows it for the client to retry", async () => {
      const overloaded = new TooManyQueriesInFlight();
      const { fetch, logged } = failingWith(overloaded);

      await expect(fetch()).rejects.toBe(overloaded);
      expect(logged.map(({ level, fields }) => ({ level, error: fields.error }))).toEqual([
        { level: "warn", error: overloaded },
      ]);
    });
  });
});
