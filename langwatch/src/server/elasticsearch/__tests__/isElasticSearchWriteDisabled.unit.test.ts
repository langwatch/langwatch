import { describe, expect, it, vi } from "vitest";
import {
  isElasticSearchWriteDisabled,
} from "../isElasticSearchWriteDisabled";

function createMockPrisma(
  flags: {
    disableElasticSearchTraceWriting?: boolean;
    disableElasticSearchEvaluationWriting?: boolean;
    disableElasticSearchSimulationWriting?: boolean;
    featureClickHouseDataSourceTraces?: boolean;
    featureClickHouseDataSourceEvaluations?: boolean;
    featureClickHouseDataSourceSimulations?: boolean;
    featureEventSourcingTraceIngestion?: boolean;
    featureEventSourcingEvaluationIngestion?: boolean;
    featureEventSourcingSimulationIngestion?: boolean;
  } | null,
) {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue(flags),
    },
  } as any;
}

describe("isElasticSearchWriteDisabled()", () => {
  describe("given domain is traces", () => {
    describe("when disableElasticSearchTraceWriting is false", () => {
      it("returns false", async () => {
        const prisma = createMockPrisma({
          disableElasticSearchTraceWriting: false,
          featureClickHouseDataSourceTraces: false,
          featureEventSourcingTraceIngestion: false,
        });

        const result = await isElasticSearchWriteDisabled(
          prisma,
          "trace-default-1",
          "traces",
        );
        expect(result).toBe(false);
      });
    });

    describe("when disableElasticSearchTraceWriting is true", () => {
      it("returns true", async () => {
        const prisma = createMockPrisma({
          disableElasticSearchTraceWriting: true,
          featureClickHouseDataSourceTraces: true,
          featureEventSourcingTraceIngestion: true,
        });

        const result = await isElasticSearchWriteDisabled(
          prisma,
          "trace-disabled-1",
          "traces",
        );
        expect(result).toBe(true);
      });
    });

    describe("when ES write is disabled but CH read is not enabled", () => {
      it("returns true and logs a warning", async () => {
        const prisma = createMockPrisma({
          disableElasticSearchTraceWriting: true,
          featureClickHouseDataSourceTraces: false,
          featureEventSourcingTraceIngestion: false,
        });

        const result = await isElasticSearchWriteDisabled(
          prisma,
          "trace-no-ch-read-1",
          "traces",
        );
        expect(result).toBe(true);
      });
    });
  });

  describe("given domain is evaluations", () => {
    describe("when disableElasticSearchEvaluationWriting is false", () => {
      it("returns false", async () => {
        const prisma = createMockPrisma({
          disableElasticSearchEvaluationWriting: false,
          featureClickHouseDataSourceEvaluations: false,
          featureEventSourcingEvaluationIngestion: false,
        });

        const result = await isElasticSearchWriteDisabled(
          prisma,
          "eval-default-1",
          "evaluations",
        );
        expect(result).toBe(false);
      });
    });

    describe("when disableElasticSearchEvaluationWriting is true", () => {
      it("returns true", async () => {
        const prisma = createMockPrisma({
          disableElasticSearchEvaluationWriting: true,
          featureClickHouseDataSourceEvaluations: true,
          featureEventSourcingEvaluationIngestion: true,
        });

        const result = await isElasticSearchWriteDisabled(
          prisma,
          "eval-disabled-1",
          "evaluations",
        );
        expect(result).toBe(true);
      });
    });
  });

  describe("given domain is simulations", () => {
    describe("when disableElasticSearchSimulationWriting is false", () => {
      it("returns false", async () => {
        const prisma = createMockPrisma({
          disableElasticSearchSimulationWriting: false,
          featureClickHouseDataSourceSimulations: false,
          featureEventSourcingSimulationIngestion: false,
        });

        const result = await isElasticSearchWriteDisabled(
          prisma,
          "sim-default-1",
          "simulations",
        );
        expect(result).toBe(false);
      });
    });

    describe("when disableElasticSearchSimulationWriting is true", () => {
      it("returns true", async () => {
        const prisma = createMockPrisma({
          disableElasticSearchSimulationWriting: true,
          featureClickHouseDataSourceSimulations: true,
          featureEventSourcingSimulationIngestion: true,
        });

        const result = await isElasticSearchWriteDisabled(
          prisma,
          "sim-disabled-1",
          "simulations",
        );
        expect(result).toBe(true);
      });
    });
  });

  describe("when project is not found", () => {
    it("returns false", async () => {
      const prisma = createMockPrisma(null);

      const result = await isElasticSearchWriteDisabled(
        prisma,
        "missing-project-1",
        "traces",
      );
      expect(result).toBe(false);
    });
  });
});
