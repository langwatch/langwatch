/** @vitest-environment node
 * A legacy read whose input names a project its proof does not grant is refused before any read,
 * since the proof, not the input, decides which tenant ClickHouse reads.
 * Spec: modules/trace/specs/trace-filter-built-conditions.feature */
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

const GRANTED = "project_granted";
const OTHER = "project_other";

function readCounter() {
  const reads: unknown[] = [];
  const read = vi.fn(async (statement: unknown) => {
    reads.push(statement);
    return { json: async () => [] };
  });
  const service = mappedLegacyRead({
    resolveClickHouseClient: () => Promise.resolve({ query: read } as never),
    traceCanonicalisation: TraceCanonicalisationService.create(),
  });
  return { service, reads };
}

describe("a legacy read naming a project its proof does not grant", () => {
  /** @scenario "A legacy read refuses a project its proof does not grant" */
  it("refuses the list with project_permission_denied and reads nothing", async () => {
    const { service, reads } = readCounter();

    const list = service.listAllTracesForProject(
      { projectId: OTHER, startDate: 0, endDate: 1, filters: {}, pageSize: 10 },
      openProtections,
      { ownRead: ownProof({ projectId: GRANTED }) },
    );

    await expect(list).rejects.toMatchObject({
      code: "project_permission_denied",
      httpStatus: 403,
    });
    expect(reads).toEqual([]);
  });

  it("refuses the span and thread reads with project_permission_denied and reads nothing", async () => {
    const { service, reads } = readCounter();
    const authorization = ownProof({ projectId: GRANTED });

    await expect(
      service.findTracesWithSpans({
        authorization,
        projectId: OTHER,
        traceIds: ["t1"],
        protections: openProtections,
      }),
    ).rejects.toMatchObject({ code: "project_permission_denied" });
    await expect(
      service.findTracesByThreadId({
        authorization,
        projectId: OTHER,
        threadId: "th1",
        protections: openProtections,
      }),
    ).rejects.toMatchObject({ code: "project_permission_denied" });
    expect(reads).toEqual([]);
  });
});
