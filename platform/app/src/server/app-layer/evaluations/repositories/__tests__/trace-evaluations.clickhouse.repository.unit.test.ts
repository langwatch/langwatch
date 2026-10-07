/**
 * The drawer's evaluation-inputs panel loads lazily and renders empty when
 * there is nothing to show. A ClickHouse client that cannot be resolved for
 * the project is one of those cases; a query that the server rejects is not,
 * and still fails the read.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import { AuthorizedClickHouse } from "~/server/app-layer/clients/clickhouse/authorized-reads";
import { ownProof } from "~/test-utils/authorizationProofs";
import { TraceEvaluationsClickHouseRepository } from "../trace-evaluations.clickhouse.repository";

function repoOver({
  resolveClient,
}: {
  resolveClient: () => Promise<ClickHouseClient>;
}): TraceEvaluationsClickHouseRepository {
  return new TraceEvaluationsClickHouseRepository({
    resolveClient,
    clickhouse: new AuthorizedClickHouse({ resolveClient }),
  });
}

describe("TraceEvaluationsClickHouseRepository.findInputsByEvaluationId", () => {
  describe("given a project whose ClickHouse client cannot be resolved", () => {
    describe("when the inputs are read through a proof", () => {
      it("returns null", async () => {
        const repo = repoOver({
          resolveClient: async () => {
            throw new Error("no ClickHouse configured for this project");
          },
        });

        await expect(
          repo.findInputsByEvaluationId({
            authorization: ownProof({ projectId: "tenant-1" }),
            evaluationId: "eval-1",
          }),
        ).resolves.toBeNull();
      });
    });
  });

  describe("given a resolved client whose query fails", () => {
    describe("when the inputs are read through a proof", () => {
      it("throws", async () => {
        const client = {
          query: vi.fn(async () => {
            throw new Error("Code: 62. Syntax error");
          }),
        } as unknown as ClickHouseClient;
        const repo = repoOver({ resolveClient: async () => client });

        await expect(
          repo.findInputsByEvaluationId({
            authorization: ownProof({ projectId: "tenant-1" }),
            evaluationId: "eval-1",
          }),
        ).rejects.toThrow("Failed to fetch evaluation inputs");
      });
    });
  });

  describe("given a resolved client holding the evaluation", () => {
    describe("when the inputs are read through a proof", () => {
      it("returns the parsed inputs with the project they were read from", async () => {
        const client = {
          query: vi.fn(async () => ({
            json: async () => [
              { TenantId: "tenant-1", Inputs: '{"question":"hi"}' },
            ],
          })),
        } as unknown as ClickHouseClient;
        const repo = repoOver({ resolveClient: async () => client });

        await expect(
          repo.findInputsByEvaluationId({
            authorization: ownProof({ projectId: "tenant-1" }),
            evaluationId: "eval-1",
          }),
        ).resolves.toEqual({
          tenantId: "tenant-1",
          inputs: { question: "hi" },
        });
      });
    });
  });
});
