// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * What the rules pane claims about the fleet before the fleet has arrived.
 *
 * WHY THIS FILE EXISTS. A count is a claim. `AnomalyRulesTab` gated its counts
 * on `!rulesQuery.error`, which is true while the list is still in flight, so
 * the page rendered a spinner and, beside it, "0" and "No critical rules." for
 * every severity — three confident statements about data nobody had yet. An
 * admin reading it during a slow load is told their organization has no rules,
 * which is exactly the answer that would make them stop looking.
 *
 * The loaded case is asserted alongside it, because "renders no count" is
 * satisfied by a component that renders nothing at all, and a genuinely empty
 * fleet does need to say zero.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasPermissionWithHierarchy } from "~/server/api/rbac";

const harness = vi.hoisted(() => ({
  permissions: [] as string[],
  rulesQuery: { data: undefined, isLoading: true, error: null } as {
    data: unknown;
    isLoading: boolean;
    error: unknown;
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => {
  const holds = (permission: string) =>
    hasPermissionWithHierarchy(harness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({
    isEnterprise: true,
    isLoading: false,
    activePlan: undefined,
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => {
  const mutation = () => ({
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      variables: undefined,
      data: undefined,
      error: null,
      reset: vi.fn(),
    }),
  });
  return {
    api: {
      useUtils: () => ({
        anomalyRules: { list: { invalidate: vi.fn() } },
      }),
      anomalyRules: {
        list: {
          useQuery: () => ({
            ...harness.rulesQuery,
            isFetching: harness.rulesQuery.isLoading,
            refetch: vi.fn(),
          }),
        },
        create: mutation(),
        update: mutation(),
        archive: mutation(),
      },
      ingestionSources: {
        list: {
          useQuery: () => ({ data: [], isLoading: false, error: null }),
        },
      },
    },
  };
});

import { AnomalyRulesTab } from "../AnomalyRulesTab";

function mount() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnomalyRulesTab />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  harness.permissions = ["anomalyRules:view", "anomalyRules:manage"];
});

afterEach(() => {
  cleanup();
});

describe("given a manager opening the anomaly rules pane", () => {
  describe("when the rule list is still loading", () => {
    beforeEach(() => {
      harness.rulesQuery = { data: undefined, isLoading: true, error: null };
    });

    it("shows the severity sections without claiming how many rules there are", async () => {
      mount();

      expect(await screen.findByText("Critical")).toBeInTheDocument();
      expect(screen.queryByText("No critical rules.")).not.toBeInTheDocument();
      expect(screen.queryAllByText("0")).toHaveLength(0);
    });
  });

  describe("when the rule list has arrived and is empty", () => {
    beforeEach(() => {
      harness.rulesQuery = { data: [], isLoading: false, error: null };
    });

    it("says so, once, per severity", async () => {
      mount();

      expect(await screen.findByText("No critical rules.")).toBeInTheDocument();
      expect(screen.queryAllByText("0")).toHaveLength(3);
    });
  });

  /*
   * The error path is the other half of the condition this file is about, and
   * it has two shapes. The gate moved from `!error` to `data !== undefined`,
   * which keeps the first shape identical and deliberately changes the second:
   * a refetch that fails after a good load has a fleet to report, and hiding
   * the counts a reader was already looking at tells them less than leaving
   * them up beside the failure.
   */
  describe("when the first load fails", () => {
    beforeEach(() => {
      harness.rulesQuery = {
        data: undefined,
        isLoading: false,
        error: new Error("nope"),
      };
    });

    it("claims no count, because none ever arrived", async () => {
      mount();

      expect(await screen.findByText("Critical")).toBeInTheDocument();
      expect(screen.queryByText("No critical rules.")).not.toBeInTheDocument();
      expect(screen.queryAllByText("0")).toHaveLength(0);
    });
  });

  describe("when a refetch fails after the list already arrived", () => {
    beforeEach(() => {
      harness.rulesQuery = {
        data: [],
        isLoading: false,
        error: new Error("nope"),
      };
    });

    it("keeps the counts it already had", async () => {
      mount();

      expect(await screen.findByText("No critical rules.")).toBeInTheDocument();
      expect(screen.queryAllByText("0")).toHaveLength(3);
    });
  });
});
