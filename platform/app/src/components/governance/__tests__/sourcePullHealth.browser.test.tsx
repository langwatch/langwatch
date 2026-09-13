import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import SourcePage from "@ee/governance/dashboard/pages/ingestion-source-detail";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  source: {
    id: "source",
    name: "Anthropic import",
    sourceType: "anthropic_admin",
    status: "active",
    errorCount: 3,
    lastSuccessAt: "2026-01-02T12:00:00Z",
    parserConfig: { startingAt: "2026-01-01T00:00:00Z" },
    pullSchedule: "*/10 * * * *",
    pullStatus: {
      lastRunAt: "2026-01-02T12:10:00Z",
      outcome: "failed",
      error: "The database is busy.",
      backfillThrough: "2026-01-02T00:00:00Z",
      hasMore: true,
    },
  },
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/components/enterprise/EnterpriseLockedSurface", () => ({
  EnterpriseLockedSurface: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/components/WithFeatureFlagGuard", () => ({
  withFeatureFlagGuard: () => (component: unknown) => component,
}));
vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (component: unknown) => component,
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org" },
    hasAnyPermission: () => true,
  }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: { id: "source" } }),
}));
vi.mock("@ee/governance/dashboard/pages/ingestionSourceForms", () => ({
  useDestinationContext: () => ({}),
}));
vi.mock("@ee/governance/dashboard/pages/inventory", () => ({
  SourceEditDrawer: () => null,
}));
vi.mock("@ee/governance/dashboard/components/SourceEventsTable", () => ({
  SourceEventsTable: () => <div>Historical provider records</div>,
}));
vi.mock("@ee/governance/dashboard/components/useSourceEventsPager", () => ({
  useSourceEventsPager: () => ({ loadedCount: 25, status: "ready", rows: [] }),
}));
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      activityMonitor: { eventsForSource: { fetch: vi.fn() } },
    }),
    ingestionSources: {
      get: {
        useQuery: (_input: unknown, options: object) =>
          useQuery({
            queryKey: ["source"],
            queryFn: async () => ({ ...fixture.source }),
            ...options,
          }),
      },
      update: { useMutation: () => ({}) },
      rotateSecret: { useMutation: () => ({}) },
      archive: { useMutation: () => ({}) },
    },
    activityMonitor: {
      sourceHealthMetrics: {
        useQuery: () => ({
          data: {
            events24h: 0,
            events7d: 0,
            events30d: 0,
            lastSuccessIso: "2026-01-02T00:00:00Z",
          },
          isLoading: false,
        }),
      },
    },
  },
}));

let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ChakraProvider value={defaultSystem}>
          <SourcePage />
        </ChakraProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  client?.clear();
  vi.useRealTimers();
  fixture.source.errorCount = 3;
  fixture.source.pullStatus.outcome = "failed";
  fixture.source.pullStatus.error = "The database is busy.";
});

describe("a historical provider import with partially saved data", () => {
  it("describes failed attempts without claiming collection stopped, and shows the failure and backfill progress", async () => {
    mount();
    expect(await screen.findByText("Pulls failing")).toBeVisible();
    expect(screen.getByText(/The database is busy/)).toBeVisible();
    expect(screen.getByText(/Backfill reached/)).toBeVisible();
    expect(screen.getByText(/Last successful pull/)).toBeVisible();
  });

  it("explains older billing dates without asking to rewrite timestamps", async () => {
    mount();
    await screen.findByText("Historical provider records");
    expect(screen.queryByText(/startTimeUnixNano/)).not.toBeInTheDocument();
    expect(screen.getByText(/outside the last 30 days/)).toBeVisible();
  });

  it("refreshes the status when the next pull recovers, without reloading the page", async () => {
    vi.useFakeTimers();
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("Anthropic import")).toBeVisible();
    fixture.source.errorCount = 0;
    fixture.source.pullStatus.outcome = "completed";
    fixture.source.pullStatus.error = "";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(screen.getByText("Active")).toBeVisible();
    vi.useRealTimers();
  });
});
