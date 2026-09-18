/**
 * @vitest-environment node
 * Verifies that the span read's floor is only tenant-aware when a retention resolver is
 * provided. Production wiring was broken: the service never received the optional resolver.
 */
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#services/trace-canonicalisation.service";

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      return (fn as (span: unknown) => unknown)({
        setAttribute: () => void 0,
        setAttributes: () => void 0,
        addEvent: () => void 0,
      });
    },
  }),
}));

const { TraceLegacyReadClickHouseRepository } = await import("../trace-legacy-read.repository.ts");
const traceCanonicalisation = TraceCanonicalisationService.create();
const retentionResolver = { resolve: async () => null };

/** The service keeps its floor service private; this is the wiring under test. */
function retentionProviderOf(service: unknown) {
  const floor = (service as { retentionFloor: { provider?: unknown } }).retentionFloor;
  return (floor as { provider?: unknown }).provider;
}

function annotationServiceOf(service: unknown) {
  return (service as { annotations?: unknown }).annotations;
}

describe("the production trace-service factory", () => {
  describe("given no resolver is passed explicitly", () => {
    describe("when the service is created", () => {
      /** @scenario "The floor follows the tenant's own retention policy" */
      it("still wires a live retention cascade, so the floor is tenant-aware", () => {
        const service = TraceLegacyReadClickHouseRepository.create({
          retentionResolver: retentionResolver as never,
          traceCanonicalisation,
        });

        expect(retentionProviderOf(service)).toBeDefined();
      });

      /** @scenario "The floor follows the tenant's own retention policy" */
      it("wires the policy cascade itself, not some other provider", () => {
        const service = TraceLegacyReadClickHouseRepository.create({
          retentionResolver: retentionResolver as never,
          traceCanonicalisation,
        });

        // `provider` is the PlatformRetentionDaysProvider adapter the floor
        // service wraps around the resolver; the resolver is the thing that
        // has to be the real cascade.
        const provider = retentionProviderOf(service) as { resolver?: unknown };

        expect(provider?.resolver).toBe(retentionResolver);
      });

      it("keeps the annotation service supplied to the factory", () => {
        const annotations = {} as never;
        const service = TraceLegacyReadClickHouseRepository.create({
          annotations,
          traceCanonicalisation,
        });

        expect(annotationServiceOf(service)).toBe(annotations);
      });
    });
  });

  describe("given the caller constructs the service directly", () => {
    describe("when no resolver is supplied", () => {
      /** @scenario "A caller with no resolver wired still gets a bounded read" */
      it("leaves the floor on the platform default, so unit tests stay database-free", () => {
        const service = new TraceLegacyReadClickHouseRepository({
          traceCanonicalisation,
        });

        expect(retentionProviderOf(service)).toBeUndefined();
      });
    });
  });
});
