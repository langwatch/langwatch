import { AutomationDatasetUnavailableError } from "@langwatch/automation-contract";
import { HandledError } from "@langwatch/handled-error";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSettlementFixture,
  settlementContext,
  settlementTrigger,
} from "../../__tests__/fixtures/settlement.fixtures.ts";

const loggerWarn = vi.hoisted(() => vi.fn());
const loggerError = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
    error: loggerError,
  }),
}));

class RateLimitedRefusal extends HandledError {
  constructor() {
    super("rate_limited", "Too many requests", { httpStatus: 429, fault: "customer" });
  }
}

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

  describe("given an email automation that keeps firing with recipients that no longer validate", () => {
    describe("when several matches settle", () => {
      /** @scenario "An automation that keeps firing with an invalid saved configuration warns once per window" */
      it("ends each dispatch without retrying and warns once for the automation", async () => {
        const fixture = createSettlementFixture(
          settlementTrigger("SEND_EMAIL", { actionParams: { members: [] } }),
        );

        for (const messageKey of ["digest:1", "digest:2", "digest:3"]) {
          await expect(
            fixture.service.notifyDigest(digest, settlementContext(messageKey)),
          ).resolves.toBeUndefined();
        }

        expect(fixture.delivery.emails).toHaveLength(0);
        expect(refusalWarnings()).toHaveLength(1);
        expect(fixture.observability.captures).toEqual([]);
        expect(loggerError).not.toHaveBeenCalled();
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

  describe("given a persist action refused with a rate limit", () => {
    describe("when the persist page settles", () => {
      /** @scenario "A rate-limited refusal is retried rather than treated as the customer's to fix" */
      it("rethrows the refusal for a retry and logs no configuration refusal", async () => {
        const fixture = createSettlementFixture(
          settlementTrigger("ADD_TO_DATASET", {
            actionParams: {
              datasetId: "dataset-1",
              datasetMapping: { mapping: {}, expansions: [] },
            },
          }),
        );
        const rateLimited = new RateLimitedRefusal();
        fixture.writer.errors.set("trace-1", rateLimited);

        const thrown = await refusalOf(
          fixture.service.persistMatch(
            { triggerId: "trigger-1", traceIds: ["trace-1"] },
            settlementContext("persist:page-1"),
          ),
        );

        expect(thrown).toBe(rateLimited);
        expect(refusalWarnings()).toEqual([]);
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
