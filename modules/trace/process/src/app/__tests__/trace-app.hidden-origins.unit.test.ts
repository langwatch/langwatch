/**
 * The Explorer's hidden origins on the real `TraceModule`: Langy's turns stay
 * out of a regular project's list and counts, and show in the owner's personal one.
 * @see specs/traces-v2/origin-badge-filter.feature
 */
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { LANGY_TRACE_ORIGIN } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { HIDDEN_ORIGINS_PARAM } from "../../rules/trace-filter-hidden-origins.rules.ts";
import type { TracesListReader } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const PROJECT_ID = "project-1";
const TIME_RANGE = { from: 1_000, to: 2_000 };

function harness({ isPersonal }: { isPersonal: boolean | null }) {
  const findById = vi.fn<ProjectApi["findById"]>(async () =>
    isPersonal === null ? null : ({ id: PROJECT_ID, isPersonal } as Project),
  );
  const getFacets = vi.fn<TracesListReader["getFacets"]>(async () => []);
  const app = createTraceAppHarness({
    projects: createApiFixture<ProjectApi>({ findById }, "projects"),
    traces: { list: createApiFixture<TracesListReader>({ getFacets }, "list") },
  });
  return { app, findById, getFacets };
}

async function hiddenOriginsOf(app: ReturnType<typeof harness>["app"]) {
  const { params } = await app.compileExplorerTraceFilter({
    query: "",
    tenantId: PROJECT_ID,
    timeRange: TIME_RANGE,
  });
  return params[HIDDEN_ORIGINS_PARAM];
}

async function statusFacetFilter(harnessed: ReturnType<typeof harness>) {
  await harnessed.app.readFilteredFacets({
    projectId: PROJECT_ID,
    timeRange: TIME_RANGE,
    query: "status:error",
    authorization: ownProof({ projectId: PROJECT_ID }),
  });
  const [call] = harnessed.getFacets.mock.calls;
  return call?.[0].filterFor({ key: "status", table: "trace_summaries" });
}

describe("TraceModule hidden origins", () => {
  describe("given a regular project", () => {
    /** @scenario "The list leaves out Langy's turns by default" */
    it("leaves Langy's turns out of the list filter and the facet counts", async () => {
      const harnessed = harness({ isPersonal: false });

      await expect(hiddenOriginsOf(harnessed.app)).resolves.toEqual([LANGY_TRACE_ORIGIN]);
      expect((await statusFacetFilter(harnessed))?.params[HIDDEN_ORIGINS_PARAM]).toEqual([
        LANGY_TRACE_ORIGIN,
      ]);
      expect(harnessed.findById).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  describe("given a project that no longer resolves", () => {
    it("keeps Langy's turns out", async () => {
      const { app } = harness({ isPersonal: null });

      await expect(hiddenOriginsOf(app)).resolves.toEqual([LANGY_TRACE_ORIGIN]);
    });
  });

  describe("given the person's own personal project", () => {
    /** @scenario "A personal project shows Langy's turns" */
    it("hides no origin from the list filter or the facet counts", async () => {
      const harnessed = harness({ isPersonal: true });

      await expect(hiddenOriginsOf(harnessed.app)).resolves.toBeUndefined();
      expect((await statusFacetFilter(harnessed))?.params[HIDDEN_ORIGINS_PARAM]).toBeUndefined();
    });
  });
});
