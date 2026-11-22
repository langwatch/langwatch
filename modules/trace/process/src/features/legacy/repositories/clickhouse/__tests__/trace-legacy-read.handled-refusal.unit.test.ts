/** @vitest-environment node
 * A handled refusal from the ClickHouse router (a private organization whose route is missing)
 * reaches the caller as itself, not wrapped in a bare Error that answers 500 internal_error.
 * Spec: modules/trace/specs/trace-read-service.feature */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { mappedLegacyRead } from "./support/legacy-trace-mapping.support.ts";

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

const { openProtections } =
  await import("../../../../../repositories/clickhouse/__tests__/open-protections.ts");

const PROJECT = "project_private_refused";

/** Shaped as packages/process-stores' PrivateDataplaneUnavailableError, which it doesn't export. */
class RouteRefusal extends HandledError {
  constructor() {
    super(
      "private_dataplane_unavailable",
      "This organization keeps its data on its own ClickHouse, which this deployment cannot reach",
      {
        httpStatus: 503,
        fault: "platform",
        retryable: false,
        meta: {
          organizationId: "org123",
          kind: "clickhouse",
          variable: "CLICKHOUSE_URL__acme__org123",
        },
      },
    );
  }
}

const routeRefusal = (): HandledError => new RouteRefusal();

describe("a trace read for a private organization whose route is missing", () => {
  /** @scenario "A trace read for a private organization whose route is missing answers the handled refusal" */
  it("rejects with private_dataplane_unavailable, not a wrapped internal error", async () => {
    const service = mappedLegacyRead({
      resolveClickHouseClient: () =>
        Promise.resolve({ query: () => Promise.reject(routeRefusal()) } as never),
      traceCanonicalisation: TraceCanonicalisationService.create(),
    });

    const read = service.findTracesWithSpans({
      authorization: ownProof({ projectId: PROJECT }),
      projectId: PROJECT,
      traceIds: ["trace_1"],
      protections: openProtections,
    });

    await expect(read).rejects.toMatchObject({
      code: "private_dataplane_unavailable",
      httpStatus: 503,
    });
  });
});
