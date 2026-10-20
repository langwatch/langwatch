import type { AnnotationApi } from "@langwatch/annotation-contract";
import { AutomationDatasetUnavailableError } from "@langwatch/automation-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { refusesRetry } from "@langwatch/group-queue";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSettlementFixture,
  settlementContext,
  settlementTrigger,
} from "../../__tests__/fixtures/settlement.fixtures.ts";
import { PersistActionWriterService } from "../../features/runaway/services/persist-action-writer.service.ts";

const loggerWarn = vi.hoisted(() => vi.fn());
const loggerError = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
    error: loggerError,
  }),
}));

const digest = { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 };

function refusalWarnings() {
  return loggerWarn.mock.calls.filter(([fields]) => typeof fields?.code === "string");
}

async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  return write.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("settlement refusals caused by the automation's saved configuration", () => {
  afterEach(() => {
    loggerWarn.mockClear();
    loggerError.mockClear();
  });

  describe("given an email automation whose stored recipients no longer validate", () => {
    describe("when the match settles", () => {
      /** @scenario "An email automation whose saved recipients no longer validate is refused as the customer's to fix" */
      it("ends the dispatch with one customer-fault warning and reports no error", async () => {
        const fixture = createSettlementFixture(
          settlementTrigger("SEND_EMAIL", { actionParams: { members: ["not an address"] } }),
        );

        await expect(
          fixture.service.notifyDigest(digest, settlementContext()),
        ).resolves.toBeUndefined();

        expect(fixture.delivery.emails).toHaveLength(0);
        expect(refusalWarnings()).toEqual([
          [
            expect.objectContaining({
              triggerId: "trigger-1",
              code: "invalid_action_params",
              fault: "customer",
            }),
            expect.any(String),
          ],
        ]);
        expect(loggerError).not.toHaveBeenCalled();
        expect(fixture.observability.captures).toEqual([]);
      });
    });
  });

  describe("given a webhook automation whose stored settings no longer parse", () => {
    describe("when the match settles", () => {
      /** @scenario "A webhook automation whose saved settings no longer parse is refused as the customer's to fix" */
      it("ends the dispatch with a customer-fault refusal instead of retrying", async () => {
        const fixture = createSettlementFixture(
          settlementTrigger("SEND_WEBHOOK", { actionParams: { url: 42 } }),
        );

        await expect(
          fixture.service.notifyDigest(digest, settlementContext()),
        ).resolves.toBeUndefined();

        expect(fixture.delivery.webhooks).toHaveLength(0);
        expect(refusalWarnings()).toEqual([
          [
            expect.objectContaining({ code: "invalid_action_params", fault: "customer" }),
            expect.any(String),
          ],
        ]);
        expect(fixture.observability.captures).toEqual([]);
      });
    });
  });

  describe("given a dataset automation whose dataset is gone or archived", () => {
    describe("when the match is written", () => {
      /** @scenario "A dataset automation whose dataset is gone is refused as the customer's to fix" */
      it("refuses with a customer-fault code that the queue does not redeliver", async () => {
        const writer = PersistActionWriterService.create({
          datasets: createApiFixture<DatasetApi>({ findBySlugOrId: async () => null }),
          annotations: createApiFixture<AnnotationApi>(),
        });

        const refusal = await refusalOf(
          writer.addToDataset({
            datasetId: "dataset-1",
            projectId: "project-1",
            triggerId: "trigger-1",
            datasetRecords: [{ id: "trigger-1-trace-1-0", question: "why" }],
          }),
        );

        expect(refusal).toEqual(
          expect.objectContaining({ code: "automation_dataset_unavailable", fault: "customer" }),
        );
        expect(refusesRetry(refusal)).toBe(true);
      });
    });
  });

  describe("given a persist action refused as the customer's to fix", () => {
    describe("when the persist page settles", () => {
      /** @scenario "A persist refusal the customer must fix is warned once and not retried" */
      it("completes the page, warns once and reports no error", async () => {
        const fixture = createSettlementFixture(
          settlementTrigger("ADD_TO_DATASET", {
            actionParams: {
              datasetId: "dataset-1",
              datasetMapping: { mapping: {}, expansions: [] },
            },
          }),
        );
        fixture.writer.errors.set(
          "trace-1",
          new AutomationDatasetUnavailableError({
            datasetId: "dataset-1",
            reason: "it is gone or archived",
          }),
        );

        await expect(
          fixture.service.persistMatch(
            { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
            settlementContext("persist:page-1"),
          ),
        ).resolves.toBeUndefined();

        expect(fixture.automation.claims.map(({ traceId }) => traceId)).toEqual(["trace-2"]);
        expect(refusalWarnings()).toEqual([
          [
            expect.objectContaining({
              traceId: "trace-1",
              code: "automation_dataset_unavailable",
              fault: "customer",
            }),
            expect.any(String),
          ],
        ]);
        expect(loggerError).not.toHaveBeenCalled();
        expect(fixture.observability.captures).toEqual([]);
      });
    });
  });

  describe("given a dispatch failure that names no cause", () => {
    describe("when the match settles", () => {
      /** @scenario "A dispatch failure we cannot name is reported once and retried" */
      it("reports the failure exactly once and rethrows it for a retry", async () => {
        const fixture = createSettlementFixture(
          settlementTrigger("ADD_TO_DATASET", {
            actionParams: {
              datasetId: "dataset-1",
              datasetMapping: { mapping: {}, expansions: [] },
            },
          }),
        );
        const outage = new Error("connection reset");
        fixture.writer.errors.set("trace-1", outage);

        const thrown = await refusalOf(
          fixture.service.persistMatch(
            { triggerId: "trigger-1", traceIds: ["trace-1"] },
            settlementContext("persist:page-1"),
          ),
        );

        expect(thrown).toBe(outage);
        expect(fixture.observability.captures).toEqual([
          expect.objectContaining({
            error: outage,
            extra: expect.objectContaining({ retryable: true }),
          }),
        ]);
        expect(loggerError).not.toHaveBeenCalled();
      });
    });
  });
});
