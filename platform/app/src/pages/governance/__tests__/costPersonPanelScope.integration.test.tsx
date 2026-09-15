/**
 * @vitest-environment jsdom
 *
 * What the cost screen asks the per-person read for.
 *
 * The panel beside it, "Tokens by department", already covers every project of
 * the organization. This one asked for the hidden governance project alone,
 * and for traffic that arrived through a governance ingestion source, so two
 * panels reporting the same unit off the same table answered over different
 * populations — the department one printing a token count and the person one
 * printing "nothing in this window yet" over the very same rows.
 *
 * The scope is a per-caller choice rather than a widening of the read, because
 * three other screens read the same procedure for dollars and ADR-128 ruling 6
 * forbids a money figure moving as a side effect. So the assertion is on what
 * this screen asks for, exactly as the sort key beside it is.
 *
 * Spec: specs/governance/governance-cost-screen.feature — rule "A people panel
 * measures tokens and says which store it read".
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** What each read was asked for, keyed by procedure path. */
  inputs: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    organizations: [],
    project: undefined,
    hasPermission: () => true,
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));
vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));
vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/NotFoundScene", () => ({
  NotFoundScene: () => <div>this page does not exist</div>,
}));
vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>loading</div>,
}));

vi.mock("~/utils/api", () => {
  /**
   * Every read records what it was asked for under its own path. A Proxy
   * rather than a literal list of procedures: the page adds and drops reads
   * often, and an unlisted one throwing would make this suite fail for a
   * reason that has nothing to do with the scope.
   */
  const recording = (path: string) => ({
    useQuery: (input: Record<string, unknown>) => {
      harness.inputs[path] = input;
      return { data: undefined, isLoading: false, isError: false };
    },
  });
  const router = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (_target, procedure: string) => recording(`${name}.${procedure}`),
    });
  return {
    api: new Proxy({} as Record<string, unknown>, {
      get: (_target, name: string) => router(name),
    }),
  };
});

import CostsPage from "../costs";

beforeEach(() => {
  harness.inputs = {};
});
afterEach(() => cleanup());

describe("the cost screen's panel counting people", () => {
  describe("given a permitted viewer opens the page", () => {
    /** @scenario "The panel counting people covers every project of the organization" */
    it("asks for the organization's people, not the governance project's", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <CostsPage />
        </ChakraProvider>,
      );

      const asked = harness.inputs["activityMonitor.spendByUser"];
      expect(asked).toBeDefined();
      expect(asked).toMatchObject({ scope: "organization" });
      // The scope rides the same seam the unit already took: this panel leads
      // with tokens and is ranked on the server, so both travel together or
      // page one is the top eight of a different population.
      expect(asked).toMatchObject({ sortBy: "tokens" });
    });

    /** @scenario "The panel counting people covers every project of the organization" */
    it("leaves the department panel beside it reading the organization too", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <CostsPage />
        </ChakraProvider>,
      );

      // `spendByDepartment` is org-wide server-side and takes no scope
      // argument. Asserting it is still asked for pins that the two panels are
      // fed by the same window, which is the other half of them agreeing.
      const department = harness.inputs["activityMonitor.spendByDepartment"];
      const person = harness.inputs["activityMonitor.spendByUser"];
      expect(department).toBeDefined();
      expect(person?.windowDays).toBe(department?.windowDays);
      expect(person?.organizationId).toBe(department?.organizationId);
    });
  });
});
