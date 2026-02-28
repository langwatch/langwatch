import { beforeEach, describe, expect, it, vi } from "vitest";
import { StripeUsageReportingService } from "../services/usageReportingService";

const createMockStripe = () => ({
  billing: {
    meterEvents: { create: vi.fn() },
    meters: { listEventSummaries: vi.fn() },
  },
});

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  eventName: "langwatch_billable_events",
  value: 100,
  timestamp: 1708300800,
  identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
  ...overrides,
});

const makeStripeError = ({
  type,
  rawType,
  code,
  message = "error",
}: {
  type: string;
  rawType: string;
  code?: string;
  message?: string;
}) => {
  const err = new Error(message);
  (err as any).type = type;
  (err as any).rawType = rawType;
  (err as any).code = code;
  return err;
};

describe("usageReportingService", () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let service: StripeUsageReportingService;

  beforeEach(() => {
    stripe = createMockStripe();
    service = new StripeUsageReportingService({
      stripe: stripe as any,
      meterId: "mtr_test_abc123",
    });
  });

  describe("reportUsageDelta()", () => {
    describe("when given valid events", () => {
      it("calls Stripe API with correct params and returns reported: true", async () => {
        stripe.billing.meterEvents.create.mockResolvedValue({});

        const results = await service.reportUsageDelta({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [makeEvent()],
        });

        expect(results).toEqual([
          {
            identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
            reported: true,
            valueSent: 100,
          },
        ]);
        expect(stripe.billing.meterEvents.create).toHaveBeenCalledWith({
          event_name: "langwatch_billable_events",
          payload: {
            stripe_customer_id: "cus_abc123",
            value: "100",
          },
          identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
          timestamp: 1708300800,
        });
      });
    });

    describe("when value is zero", () => {
      it("skips and returns reported: false without calling Stripe", async () => {
        const results = await service.reportUsageDelta({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [makeEvent({ value: 0 })],
        });

        expect(results).toEqual([
          {
            identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
            reported: false,
            valueSent: 0,
          },
        ]);
        expect(stripe.billing.meterEvents.create).not.toHaveBeenCalled();
      });
    });

    describe("when batch has multiple events", () => {
      it("processes sequentially and returns ordered results", async () => {
        const callOrder: number[] = [];
        stripe.billing.meterEvents.create.mockImplementation(async () => {
          callOrder.push(callOrder.length + 1);
          return {};
        });

        const results = await service.reportUsageDelta({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [
            makeEvent({ value: 10, identifier: "id1" }),
            makeEvent({ value: 20, identifier: "id2" }),
            makeEvent({ value: 30, identifier: "id3" }),
          ],
        });

        expect(results).toHaveLength(3);
        expect(results[0]!.valueSent).toBe(10);
        expect(results[1]!.valueSent).toBe(20);
        expect(results[2]!.valueSent).toBe(30);
        expect(callOrder).toEqual([1, 2, 3]);
      });
    });

    describe("when Stripe returns resource_already_exists", () => {
      it("treats as success (duplicate identifier)", async () => {
        stripe.billing.meterEvents.create.mockRejectedValue(
          makeStripeError({
            type: "StripeInvalidRequestError",
            rawType: "invalid_request_error",
            code: "resource_already_exists",
          })
        );

        const results = await service.reportUsageDelta({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [makeEvent()],
        });

        expect(results).toEqual([
          {
            identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
            reported: true,
            valueSent: 100,
          },
        ]);
      });
    });

    describe("when Stripe returns other StripeInvalidRequestError", () => {
      it("returns reported: false with error message", async () => {
        stripe.billing.meterEvents.create.mockRejectedValue(
          makeStripeError({
            type: "StripeInvalidRequestError",
            rawType: "invalid_request_error",
            code: "meter_not_found",
            message: "No such meter",
          })
        );

        const results = await service.reportUsageDelta({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [makeEvent()],
        });

        expect(results).toEqual([
          {
            identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
            reported: false,
            valueSent: 0,
            error: "No such meter",
          },
        ]);
      });
    });

    describe("when Stripe returns StripeAuthenticationError", () => {
      it("returns reported: false with error message", async () => {
        stripe.billing.meterEvents.create.mockRejectedValue(
          makeStripeError({
            type: "StripeAuthenticationError",
            rawType: "authentication_error",
            message: "Invalid API Key",
          })
        );

        const results = await service.reportUsageDelta({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [makeEvent()],
        });

        expect(results).toEqual([
          {
            identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
            reported: false,
            valueSent: 0,
            error: "Invalid API Key",
          },
        ]);
      });
    });

    describe("when Stripe returns StripeRateLimitError", () => {
      it("re-throws for BullMQ retry", async () => {
        const error = makeStripeError({
          type: "StripeRateLimitError",
          rawType: "rate_limit_error",
          message: "Rate limit exceeded",
        });
        stripe.billing.meterEvents.create.mockRejectedValue(error);

        await expect(
          service.reportUsageDelta({
            stripeCustomerId: "cus_abc123",
            organizationId: "org_1",
            events: [makeEvent()],
          })
        ).rejects.toThrow("Rate limit exceeded");
      });
    });

    describe("when input validation fails", () => {
      it("throws ZodError for missing stripeCustomerId prefix", async () => {
        await expect(
          service.reportUsageDelta({
            stripeCustomerId: "invalid",
            organizationId: "org_1",
            events: [makeEvent()],
          })
        ).rejects.toThrow();
      });

      it("throws ZodError for empty events array", async () => {
        await expect(
          service.reportUsageDelta({
            stripeCustomerId: "cus_abc123",
            organizationId: "org_1",
            events: [],
          })
        ).rejects.toThrow();
      });

      it("throws ZodError for negative value", async () => {
        await expect(
          service.reportUsageDelta({
            stripeCustomerId: "cus_abc123",
            organizationId: "org_1",
            events: [makeEvent({ value: -1 })],
          })
        ).rejects.toThrow();
      });
    });
  });

  describe("getUsageSummary()", () => {
    describe("when Stripe returns a summary", () => {
      it("returns aggregatedValue from response", async () => {
        stripe.billing.meters.listEventSummaries.mockResolvedValue({
          data: [
            {
              aggregated_value: 42,
              start_time: 1708300800,
              end_time: 1708387200,
            },
          ],
        });

        const result = await service.getUsageSummary({
          stripeCustomerId: "cus_abc123",
          startTime: 1708300800,
          endTime: 1708387200,
        });

        expect(result).toEqual({
          aggregatedValue: 42,
          startTime: 1708300800,
          endTime: 1708387200,
        });
        expect(
          stripe.billing.meters.listEventSummaries
        ).toHaveBeenCalledWith("mtr_test_abc123", {
          customer: "cus_abc123",
          start_time: 1708300800,
          end_time: 1708387200,
        });
      });
    });

    describe("when Stripe returns empty data", () => {
      it("returns aggregatedValue: 0", async () => {
        stripe.billing.meters.listEventSummaries.mockResolvedValue({
          data: [],
        });

        const result = await service.getUsageSummary({
          stripeCustomerId: "cus_abc123",
          startTime: 1708300800,
          endTime: 1708387200,
        });

        expect(result).toEqual({
          aggregatedValue: 0,
          startTime: 1708300800,
          endTime: 1708387200,
        });
      });
    });

    describe("when Stripe returns StripeInvalidRequestError", () => {
      it("re-throws the error", async () => {
        stripe.billing.meters.listEventSummaries.mockRejectedValue(
          makeStripeError({
            type: "StripeInvalidRequestError",
            rawType: "invalid_request_error",
            message: "No such meter",
          })
        );

        await expect(
          service.getUsageSummary({
            stripeCustomerId: "cus_abc123",
            startTime: 1708300800,
            endTime: 1708387200,
          })
        ).rejects.toThrow("No such meter");
      });
    });

    describe("when input validation fails", () => {
      it("throws ZodError for bad customer prefix", async () => {
        await expect(
          service.getUsageSummary({
            stripeCustomerId: "invalid",
            startTime: 1708300800,
            endTime: 1708387200,
          })
        ).rejects.toThrow();
      });

      it("throws ZodError when endTime <= startTime", async () => {
        await expect(
          service.getUsageSummary({
            stripeCustomerId: "cus_abc123",
            startTime: 1708387200,
            endTime: 1708300800,
          })
        ).rejects.toThrow();
      });
    });
  });

  describe("reportUsageSet()", () => {
    describe("when delta is positive", () => {
      it("sends value minus previouslyReportedValue to Stripe", async () => {
        stripe.billing.meterEvents.create.mockResolvedValue({});

        const results = await service.reportUsageSet({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [
            {
              ...makeEvent({ value: 150 }),
              previouslyReportedValue: 100,
            },
          ],
        });

        expect(results).toEqual([
          {
            identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
            reported: true,
            valueSent: 50,
          },
        ]);
        expect(stripe.billing.meterEvents.create).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({ value: "50" }),
          })
        );
      });
    });

    describe("when delta is zero", () => {
      it("skips and returns reported: false", async () => {
        const results = await service.reportUsageSet({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [
            {
              ...makeEvent({ value: 100 }),
              previouslyReportedValue: 100,
            },
          ],
        });

        expect(results).toEqual([
          {
            identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
            reported: false,
            valueSent: 0,
          },
        ]);
        expect(stripe.billing.meterEvents.create).not.toHaveBeenCalled();
      });
    });

    describe("when delta is negative", () => {
      it("skips (count cannot decrease)", async () => {
        const results = await service.reportUsageSet({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [
            {
              ...makeEvent({ value: 50 }),
              previouslyReportedValue: 100,
            },
          ],
        });

        expect(results).toEqual([
          {
            identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
            reported: false,
            valueSent: 0,
          },
        ]);
        expect(stripe.billing.meterEvents.create).not.toHaveBeenCalled();
      });
    });

    describe("when previouslyReportedValue is zero", () => {
      it("sends full value (first report)", async () => {
        stripe.billing.meterEvents.create.mockResolvedValue({});

        const results = await service.reportUsageSet({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [
            {
              ...makeEvent({ value: 200 }),
              previouslyReportedValue: 0,
            },
          ],
        });

        expect(results).toEqual([
          {
            identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
            reported: true,
            valueSent: 200,
          },
        ]);
        expect(stripe.billing.meterEvents.create).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({ value: "200" }),
          })
        );
      });
    });

    describe("when batch has mixed deltas", () => {
      it("only sends positive deltas to Stripe", async () => {
        stripe.billing.meterEvents.create.mockResolvedValue({});

        const results = await service.reportUsageSet({
          stripeCustomerId: "cus_abc123",
          organizationId: "org_1",
          events: [
            {
              ...makeEvent({ value: 200, identifier: "id1" }),
              previouslyReportedValue: 100,
            },
            {
              ...makeEvent({ value: 50, identifier: "id2" }),
              previouslyReportedValue: 50,
            },
            {
              ...makeEvent({ value: 30, identifier: "id3" }),
              previouslyReportedValue: 100,
            },
            {
              ...makeEvent({ value: 500, identifier: "id4" }),
              previouslyReportedValue: 0,
            },
          ],
        });

        expect(results).toHaveLength(4);
        expect(results[0]).toEqual({
          identifier: "id1",
          reported: true,
          valueSent: 100,
        });
        expect(results[1]).toEqual({
          identifier: "id2",
          reported: false,
          valueSent: 0,
        });
        expect(results[2]).toEqual({
          identifier: "id3",
          reported: false,
          valueSent: 0,
        });
        expect(results[3]).toEqual({
          identifier: "id4",
          reported: true,
          valueSent: 500,
        });
        expect(stripe.billing.meterEvents.create).toHaveBeenCalledTimes(2);
      });
    });
  });
});
