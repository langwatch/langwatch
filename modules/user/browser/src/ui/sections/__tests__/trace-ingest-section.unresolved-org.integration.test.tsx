/**
 * @vitest-environment jsdom
 * /me renders before the organisation resolves; no read may go out with a
 * placeholder organisation id, which the server answers with FORBIDDEN.
 * @see modules/user/specs/user.feature
 */
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { queryCalls, scope } = vi.hoisted(() => ({
  queryCalls: [] as { path: string; input: unknown; enabled: boolean }[],
  scope: { organization: null as { id: string; name: string } | null },
}));

/** Records every query the section fires, keyed by procedure path. */
vi.mock("../../../behavior/personal-workspace-api.ts", () => {
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        if (property === "useQuery") {
          return (input: unknown, options: { enabled?: boolean } | undefined) => {
            queryCalls.push({ path: path.join("."), input, enabled: options?.enabled ?? true });
            return { data: undefined, isSuccess: false, isPending: true };
          };
        }
        if (property === "useMutation") {
          return () => ({ mutate: () => undefined, isPending: false, error: null });
        }
        if (property === "useUtils") return () => procedure([]);
        return procedure([...path, property]);
      },
    });
  return { api: procedure([]), personalWorkspaceApi: procedure([]) };
});

vi.mock("../../../behavior/personal-workspace-session.ts", () => ({
  useCurrentUser: () => ({ id: "usr_1", email: "jane@acme.test", name: "Jane" }),
  useOrganizationTeamProject: () => ({ organization: scope.organization }),
  usePersonalDeployment: () => ({ appBaseUrl: "https://app.acme.test" }),
}));

import { TraceIngestSection } from "../trace-ingest-section.tsx";

const ingestionReads = () =>
  queryCalls.filter(
    (call) => call.path === "ingestionTemplates.list" || call.path === "ingestionKey.list",
  );

describe("given the trace ingest section on /me", () => {
  afterEach(() => {
    cleanup();
    queryCalls.length = 0;
    scope.organization = null;
  });

  describe("when the organisation has not resolved yet", () => {
    /** @scenario "The trace ingest section waits for the organisation before reading" */
    it("sends no ingestion read and names no placeholder organisation", () => {
      render(
        <DesignSystemTestProvider>
          <TraceIngestSection />
        </DesignSystemTestProvider>,
      );

      expect(ingestionReads().length).toBeGreaterThan(0);
      expect(ingestionReads().every((call) => !call.enabled)).toBe(true);
      expect(queryCalls.filter((call) => call.enabled)).toEqual([]);
      expect(JSON.stringify(queryCalls)).not.toContain("org_unknown");
    });
  });

  describe("when the organisation has resolved", () => {
    /** @scenario "The trace ingest section reads for the organisation once it resolves" */
    it("reads templates and keys for that organisation", () => {
      scope.organization = { id: "org_acme", name: "ACME" };

      render(
        <DesignSystemTestProvider>
          <TraceIngestSection />
        </DesignSystemTestProvider>,
      );

      expect(ingestionReads()).toEqual([
        { path: "ingestionTemplates.list", input: { organizationId: "org_acme" }, enabled: true },
        { path: "ingestionKey.list", input: { organizationId: "org_acme" }, enabled: true },
      ]);
    });
  });
});
