/**
 * @vitest-environment node
 *
 * The span read's floor is only tenant-aware if something actually hands the
 * service a retention resolver. Nothing did: the constructor took one as an
 * optional parameter, every production path reached the service through
 * `create()`, and `create()` never passed it — so the floor stayed at the fixed
 * 90-day `SPAN_READ_FLOOR_LOOKBACK_MS` for every project, including the ones on
 * a longer policy the change exists to serve. It typechecked, the unit tests
 * passed against injected resolvers, and the feature was inert in production.
 *
 * This pins the wiring rather than the floor arithmetic, which is covered in
 * `packages/clickhouse-client`.
 *
 * Spec: specs/clickhouse/bounded-reads.feature
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      return (fn as (span: unknown) => unknown)({
        setAttribute: () => undefined,
        setAttributes: () => undefined,
        addEvent: () => undefined,
      });
    },
  }),
}));

const { ClickHouseTraceService } = await import("../clickhouse-trace.service");
const { RetentionPolicyCache } =
  await import("~/server/data-retention/retentionPolicyCache");

/** The service keeps its floor service private; this is the wiring under test. */
function retentionProviderOf(service: unknown) {
  const floor = (service as { retentionFloor: { provider?: unknown } }).retentionFloor;
  return (floor as { provider?: unknown }).provider;
}

describe("the production trace-service factory", () => {
  describe("given no resolver is passed explicitly", () => {
    describe("when the service is created", () => {
      /** @scenario "The floor follows the tenant's own retention policy" */
      it("still wires a live retention cascade, so the floor is tenant-aware", () => {
        const service = ClickHouseTraceService.create();

        expect(retentionProviderOf(service)).toBeDefined();
      });

      /** @scenario "The floor follows the tenant's own retention policy" */
      it("wires the policy cascade itself, not some other provider", () => {
        const service = ClickHouseTraceService.create();

        // `provider` is the PlatformRetentionDaysProvider adapter the floor
        // service wraps around the resolver; the resolver is the thing that
        // has to be the real cascade.
        const provider = retentionProviderOf(service) as { resolver?: unknown };

        expect(provider?.resolver).toBeInstanceOf(RetentionPolicyCache);
      });
    });
  });

  describe("given the caller constructs the service directly", () => {
    describe("when no resolver is supplied", () => {
      /** @scenario "A caller with no resolver wired still gets a bounded read" */
      it("leaves the floor on the platform default, so unit tests stay database-free", () => {
        const service = new ClickHouseTraceService({ prisma: {} as never });

        expect(retentionProviderOf(service)).toBeUndefined();
      });
    });
  });
});
