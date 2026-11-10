/**
 * @vitest-environment jsdom
 * Tests retention policy configuration: plan gating, scope filtering, removal,
 * and error handling. See {@link specs/data-retention/retention-policy-configuration.feature}
 */

import {
  UiHostServicesContextProvider,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DataRetentionHostApi,
  DataRetentionHostProvider,
  type RetentionAvailableScopes,
  type RetentionFailureNotice,
  type RetentionHostScope,
  type RetentionRouteReading,
  type RetentionSuccessNotice,
} from "../../../model/data-retention-host.ts";
import DataRetentionScreen from "../data-retention.screen.tsx";

const {
  snapshotRef,
  invalidate,
  previewScopeRemoval,
  removeForScope,
  setForScope,
  killMutation,
  storedPastRef,
  fetchStoredPast,
  applyScope,
} = vi.hoisted(() => ({
  storedPastRef: {
    current: {
      categories: [] as {
        category: "traces" | "scenarios" | "experiments";
        rows: number;
        retentionDays: number | null;
      }[],
      projectCount: 1,
    },
  },
  fetchStoredPast: vi.fn(async (input: unknown) => {
    void input;
    return {
      categories: [
        { category: "traces" as const, rows: 1234, retentionDays: 91 },
        { category: "scenarios" as const, rows: 0, retentionDays: 91 },
        { category: "experiments" as const, rows: 0, retentionDays: 91 },
      ],
      projectCount: 2,
    };
  }),
  applyScope: vi.fn(async (input: unknown) => {
    void input;
  }),
  invalidate: vi.fn(async () => undefined),
  previewScopeRemoval: vi.fn((input: unknown) => {
    void input;
    return { data: void 0, isLoading: false, isError: false };
  }),
  removeForScope: vi.fn(async (request: unknown) => {
    void request;
  }),
  setForScope: vi.fn(async () => undefined),
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

vi.mock("../../../behavior/data-retention-api.ts", () => ({
  dataRetentionApi: {
    useUtils: () => ({
      dataRetention: {
        getRules: { invalidate },
        getStoredPastRetention: { fetch: fetchStoredPast, invalidate },
      },
    }),
    dataRetention: {
      getRules: { useQuery: () => ({ data: snapshotRef.current, isLoading: false }) },
      getStoredPastRetention: {
        useQuery: () => ({ data: storedPastRef.current, isLoading: false }),
      },
      applyScopeRetentionToStoredData: {
        useMutation: () => ({ mutateAsync: applyScope, isPending: false }),
      },
      getScopeStorageUsage: {
        useQuery: () => ({ data: { totalBytes: 1024, projectCount: 1 }, isLoading: false }),
      },
      previewScopeRemoval: { useQuery: previewScopeRemoval },
      getMutationProgress: {
        useQuery: () => ({ data: [], refetch: vi.fn() }),
      },
      setForScope: { useMutation: () => ({ mutateAsync: setForScope, isPending: false }) },
      removeForScope: {
        useMutation: () => ({ mutateAsync: removeForScope, isPending: false }),
      },
      killMutation: { useMutation: () => ({ mutate: killMutation, isPending: false }) },
    },
    organization: { getScopeGraph: { useQuery: () => ({ data: [] }) } },
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

class TestRetentionHost extends DataRetentionHostApi {
  readonly writes: Readonly<Record<string, string | undefined>>[] = [];
  readonly successes: RetentionSuccessNotice[] = [];
  readonly warnings: RetentionSuccessNotice[] = [];
  readonly infos: RetentionSuccessNotice[] = [];
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

  warned(notice: RetentionSuccessNotice): void {
    this.warnings.push(notice);
  }

  informed(notice: RetentionSuccessNotice): void {
    this.infos.push(notice);
  }

  failed(failure: RetentionFailureNotice): void {
    this.failures.push(failure);
  }
}

function renderScreen(host: TestRetentionHost, { isSaaS }: { isSaaS?: boolean } = {}) {
  const screenUnderTest = (
    <DataRetentionHostProvider value={host}>
      <DataRetentionScreen />
    </DataRetentionHostProvider>
  );
  if (isSaaS === undefined) return renderWithDesignSystem(screenUnderTest);
  const services: UiHostServices = {
    ...createUiHostServicesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => {},
    }),
    deployment: {
      isDevelopment: false,
      isSaaS,
      appBaseUrl: "http://localhost",
      hasNlpService: true,
      hasLangevals: true,
      hasEmailProvider: false,
      hasCloudOps: false,
    },
  };
  return renderWithDesignSystem(
    <UiHostServicesContextProvider value={services}>
      {screenUnderTest}
    </UiHostServicesContextProvider>,
  );
}

describe("given the retention policies page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedPastRef.current = { categories: [], projectCount: 1 };
    snapshotRef.current.canConfigureRetention = true;
    snapshotRef.current.effective = { traces: 49, scenarios: 49, experiments: 49 };
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
    it("says so on Cloud and offers no way to add a policy", () => {
      snapshotRef.current.canConfigureRetention = false;
      renderScreen(new TestRetentionHost(), { isSaaS: true });

      expect(screen.getByText("Configurable retention is a paid-plan feature")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Add retention policy" }),
      ).not.toBeInTheDocument();
    });

    /**
     * @scenario A self-hosted admin without a license is led to the License page from data retention
     * @scenario "Each Enterprise page names its feature in the shared lock"
     */
    it("leads a self-hosted admin to the License page and offers no way to add a policy", () => {
      snapshotRef.current.canConfigureRetention = false;
      renderScreen(new TestRetentionHost({}, new Set(["organization:manage"])), { isSaaS: false });

      expect(
        screen.getByText("Data retention is part of LangWatch Enterprise"),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Activate a license" })).toHaveAttribute(
        "href",
        "/settings/license",
      );
      expect(screen.getByRole("link", { name: "Get a license" })).toHaveAttribute(
        "href",
        "/settings/license",
      );
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

    it("names the deployment's own default, not a fixed constant", () => {
      snapshotRef.current.rules = [];
      snapshotRef.current.effective = { traces: 7, scenarios: 7, experiments: 7 };
      renderScreen(new TestRetentionHost());

      expect(screen.getByText(/override the platform default of/)).toHaveTextContent("7 days");
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

    /** @scenario The settings page sends its organisation with every scope write */
    it("names the page's organization on the preview and on every removal", async () => {
      const user = userEvent.setup();
      renderScreen(new TestRetentionHost());

      await user.click(screen.getByRole("button", { name: "Actions for Platform" }));
      await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
      await user.click(await screen.findByRole("button", { name: /Remove/ }));

      await waitFor(() => expect(removeForScope).toHaveBeenCalledTimes(2));
      expect(previewScopeRemoval).toHaveBeenLastCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
        expect.anything(),
      );
      for (const [request] of removeForScope.mock.calls) {
        expect(request).toMatchObject({ organizationId: "org-1" });
      }
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

  describe("when a policy is saved", () => {
    async function saveTeamPolicy(host: TestRetentionHost) {
      const user = userEvent.setup();
      renderScreen(host);
      await user.click(screen.getByRole("button", { name: "Actions for Platform" }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
      await user.click(await screen.findByRole("button", { name: "Save changes" }));
      return user;
    }

    /** @scenario "A shorter period asks to apply it with a count" */
    it("asks to apply it, naming how many stored traces it would remove", async () => {
      await saveTeamPolicy(new TestRetentionHost());

      expect(
        await screen.findByText(/1,234 traces older than 90 days will be deleted within a day\./),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apply now" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
      // A fresh read: the cached count is still the old period's.
      expect(fetchStoredPast).toHaveBeenCalledWith(
        { projectId: "proj-1", scope: { scopeType: "TEAM", scopeId: "team-1" } },
        { staleTime: 0 },
      );
    });

    it("applies the saved scope's period when the admin chooses Apply now", async () => {
      const host = new TestRetentionHost();
      const user = await saveTeamPolicy(host);

      await user.click(await screen.findByRole("button", { name: "Apply now" }));

      await waitFor(() => expect(applyScope).toHaveBeenCalledTimes(1));
      expect(applyScope).toHaveBeenCalledWith({
        projectId: "proj-1",
        organizationId: "org-1",
        scope: { scopeType: "TEAM", scopeId: "team-1" },
      });
      expect(host.successes.at(-1)?.title).toBe(
        "Traces past the new period will be deleted within a day",
      );
    });

    it("asks nothing when no stored data is past the new period", async () => {
      fetchStoredPast.mockResolvedValueOnce({ categories: [], projectCount: 2 });
      await saveTeamPolicy(new TestRetentionHost());

      await waitFor(() => expect(fetchStoredPast).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "Apply now" })).not.toBeInTheDocument();
    });

    /** @scenario "A count that fails still offers the choice" */
    it("says it could not count and still offers both choices", async () => {
      fetchStoredPast.mockRejectedValueOnce(new Error("clickhouse down"));
      await saveTeamPolicy(new TestRetentionHost());

      expect(await screen.findByText(/We couldn't count the stored traces/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apply now" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
      expect(applyScope).not.toHaveBeenCalled();
    });
  });

  describe("when stored data under the scope in view is past its period", () => {
    /** @scenario "Not now leaves a note with an Apply button" */
    it("notes how many traces still use the old period and applies it after the prompt", async () => {
      storedPastRef.current = {
        categories: [{ category: "traces", rows: 1234, retentionDays: 91 }],
        projectCount: 2,
      };
      const user = userEvent.setup();
      renderScreen(new TestRetentionHost());

      expect(screen.getByText("1,234 traces still use the old period")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(
        await screen.findByText(/1,234 traces older than 90 days will be deleted within a day\./),
      ).toBeInTheDocument();
      expect(applyScope).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Apply now" }));

      await waitFor(() => expect(applyScope).toHaveBeenCalledTimes(1));
      expect(applyScope).toHaveBeenCalledWith({
        projectId: "proj-1",
        organizationId: "org-1",
        scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
      });
    });
  });
});
