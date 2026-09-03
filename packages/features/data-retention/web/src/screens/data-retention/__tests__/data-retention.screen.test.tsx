/**
 * @vitest-environment jsdom
 *
 * Retention policies, driven the way a reader drives them.
 *
 * `platform/app/src/pages/settings/data-retention.tsx` had no test of its own —
 * only the drawer, the dialogs and the menu underneath it did — so these are
 * new, and they pin the four things the move could plausibly have broken: the
 * plan gate, the scope filter's address, the fan-out that removes a scope, and
 * the failure path handing the raw error to the host.
 *
 * Spec: specs/data-retention/retention-policy-configuration.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataRetentionHostPort,
  DataRetentionHostProvider,
  type RetentionAvailableScopes,
  type RetentionFailureNotice,
  type RetentionHostScope,
  type RetentionRouteReading,
  type RetentionSuccessNotice,
} from "../../../model/data-retention-host";
import DataRetentionScreen from "../data-retention.screen";

const { snapshotRef, invalidate, removeForScope, setForScope, triggerUpdate, killMutation } =
  vi.hoisted(() => ({
    invalidate: vi.fn(async () => undefined),
    removeForScope: vi.fn(async () => undefined),
    setForScope: vi.fn(async () => undefined),
    triggerUpdate: vi.fn(async () => ({ appliedRetentionDays: 35 })),
    killMutation: vi.fn(),
    snapshotRef: {
      current: {
        projectId: "proj-1",
        effective: { traces: 49, scenarios: 49, experiments: 49 },
        canConfigureRetention: true,
        available: {
          organization: { id: "org-1", name: "Acme" },
          teams: [{ id: "team-1", name: "Platform" }],
          projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
        },
        rules: [
          {
            scopeType: "TEAM" as const,
            scopeId: "team-1",
            name: "Platform",
            category: "traces" as const,
            retentionDays: 91,
          },
          {
            scopeType: "TEAM" as const,
            scopeId: "team-1",
            name: "Platform",
            category: "scenarios" as const,
            retentionDays: 91,
          },
        ],
      },
    },
  }));

vi.mock("../../../behavior/data-retention-api", () => ({
  dataRetentionApi: {
    useUtils: () => ({ dataRetention: { getRules: { invalidate } } }),
    dataRetention: {
      getRules: { useQuery: () => ({ data: snapshotRef.current, isLoading: false }) },
      getScopeStorageUsage: {
        useQuery: () => ({ data: { totalBytes: 1024, projectCount: 1 }, isLoading: false }),
      },
      previewScopeRemoval: {
        useQuery: () => ({ data: void 0, isLoading: false, isError: false }),
      },
      getMutationProgress: {
        useQuery: () => ({ data: [], refetch: vi.fn() }),
      },
      setForScope: { useMutation: () => ({ mutateAsync: setForScope, isPending: false }) },
      removeForScope: {
        useMutation: () => ({ mutateAsync: removeForScope, isPending: false }),
      },
      triggerRetroactiveUpdate: {
        useMutation: () => ({ mutateAsync: triggerUpdate, isPending: false }),
      },
      killMutation: { useMutation: () => ({ mutate: killMutation, isPending: false }) },
    },
    organization: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

const availableScopes: RetentionAvailableScopes = {
  organization: { id: "org-1", name: "Acme" },
  teams: [
    { id: "team-1", name: "Platform" },
    { id: "team-2", name: "Growth" },
  ],
  projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
};

class TestRetentionHost extends DataRetentionHostPort {
  readonly writes: Array<Readonly<Record<string, string | undefined>>> = [];
  readonly successes: RetentionSuccessNotice[] = [];
  readonly failures: RetentionFailureNotice[] = [];

  constructor(
    private query: Readonly<Record<string, string | undefined>> = {},
    private readonly grants: ReadonlySet<string> = new Set(["project:view"]),
    private readonly platformAdmin = false,
  ) {
    super();
  }

  scope(): RetentionHostScope {
    return { organizationId: "org-1", teamId: "team-1", projectId: "proj-1" };
  }

  hasPermission(permission: string): boolean {
    return this.grants.has(permission);
  }

  availableScopes(): RetentionAvailableScopes {
    return availableScopes;
  }

  isPlatformAdmin(): boolean {
    return this.platformAdmin;
  }

  isEnterprise(): boolean {
    return true;
  }

  route(): RetentionRouteReading {
    return { params: {}, query: this.query };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.writes.push(next);
    this.query = next;
  }

  succeeded(notice: RetentionSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: RetentionFailureNotice): void {
    this.failures.push(failure);
  }
}

function renderScreen(host: TestRetentionHost) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DataRetentionHostProvider value={host}>
        <DataRetentionScreen />
      </DataRetentionHostProvider>
    </ChakraProvider>,
  );
}

describe("given the retention policies page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotRef.current.canConfigureRetention = true;
    snapshotRef.current.rules = [
      {
        scopeType: "TEAM",
        scopeId: "team-1",
        name: "Platform",
        category: "traces",
        retentionDays: 91,
      },
      {
        scopeType: "TEAM",
        scopeId: "team-1",
        name: "Platform",
        category: "scenarios",
        retentionDays: 91,
      },
    ];
  });

  describe("when the organization's plan does not unlock configurable retention", () => {
    /** @scenario A free plan sees the policies and is offered no way to change them */
    it("says so and offers no way to add a policy", () => {
      snapshotRef.current.canConfigureRetention = false;
      renderScreen(new TestRetentionHost());

      expect(screen.getByText("Configurable retention is a paid-plan feature")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Add retention policy" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when no policy has been written yet", () => {
    /** @scenario The empty page names the default a policy would override */
    it("names the platform default the reader would be overriding", () => {
      snapshotRef.current.rules = [];
      renderScreen(new TestRetentionHost());

      expect(screen.getByText(/override the platform default of/)).toHaveTextContent("49 days");
    });
  });

  describe("when the reader narrows to a scope", () => {
    /** @scenario The scope filter is carried by the page address */
    it("writes the scope into the address rather than into component state", async () => {
      const user = userEvent.setup();
      const host = new TestRetentionHost();
      renderScreen(host);

      await user.click(screen.getByTestId("scope-filter"));
      await user.click(await screen.findByTestId("filter-this-team"));

      expect(host.writes.at(-1)).toEqual({ scope: "TEAM:team-1" });
    });
  });

  describe("when the address names a scope none of the rules belong to", () => {
    /** @scenario An address naming a scope with no policies says the filter is why */
    it("says the filter is what is hiding them, not that there are none", () => {
      renderScreen(new TestRetentionHost({ scope: "TEAM:team-2" }));

      expect(
        screen.getByText("No retention policies match the current scope filter."),
      ).toBeInTheDocument();
    });
  });

  describe("when the reader removes a scope's policy", () => {
    /** @scenario Removing a scope's policy removes every category it had set */
    it("removes every category the scope had set and reports it once", async () => {
      const user = userEvent.setup();
      const host = new TestRetentionHost();
      renderScreen(host);

      await user.click(screen.getByRole("button", { name: "Actions for Platform" }));
      await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
      await user.click(await screen.findByRole("button", { name: /Remove/ }));

      await waitFor(() => expect(removeForScope).toHaveBeenCalledTimes(2));
      expect(host.successes).toHaveLength(1);
      expect(host.successes[0]?.title).toBe("Retention policy removed");
    });

    /** @scenario A removal that fails names the action rather than a code */
    it("hands the raw error to the host when one of the calls fails", async () => {
      const user = userEvent.setup();
      const boom = new Error("nope");
      removeForScope.mockRejectedValueOnce(boom);
      const host = new TestRetentionHost();
      renderScreen(host);

      await user.click(screen.getByRole("button", { name: "Actions for Platform" }));
      await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
      await user.click(await screen.findByRole("button", { name: /Remove/ }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]).toEqual({
        error: boom,
        fallbackTitle: "Couldn't remove the retention policy",
      });
      expect(host.successes).toHaveLength(0);
    });
  });
});
