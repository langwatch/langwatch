/** @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { AgentWithFields } from "@langwatch/agent-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => {
  const agent: AgentWithFields = {
    id: "agent_1",
    projectId: "project_1",
    name: "HTTP agent",
    type: "http",
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    copyCount: 2,
    config: {
      name: "HTTP",
      description: "HTTP API endpoint",
      url: "https://example.test/run",
      method: "POST",
    },
    inputFields: [],
    outputFields: [],
    fieldsResolved: true,
  };
  return {
    agent,
    closeDrawer: vi.fn(),
    copy: vi.fn(async () => ({
      id: "agent_copy",
      projectId: "project_2",
      name: "HTTP agent",
      copiedFromAgentId: "agent_1",
    })),
    getHistory: vi.fn(async () => []),
    openDrawer: vi.fn(),
    pushToCopies: vi.fn(async () => ({ pushedTo: 1, selectedCopies: 1 })),
    routerPush: vi.fn(),
    // One stub, shared by every getUntypedClient() call, so a test can say
    // what a dispatched procedure answers.
    rpc: { query: vi.fn(async () => ({ ok: true })), mutation: vi.fn(async () => ({ ok: true })) },
  };
});

vi.mock("@langwatch/ui", () => {
  class RpcClientPort {}

  return {
    RpcClientPort,
    TrpcAgentBrowserAdapter: {
      create: () => ({
        getById: async () => host.agent,
        create: async () => host.agent,
        update: async () => host.agent,
        relatedEntities: async () => ({ workflow: null }),
        cascadeArchive: async () => ({ agent: host.agent, archivedWorkflow: null }),
        archive: async () => host.agent,
        getCopies: async () => [
          {
            id: "copy_1",
            name: "Replica A",
            projectId: "project_2",
            fullPath: "Org / Team / Project A",
          },
          {
            id: "copy_2",
            name: "Replica B",
            projectId: "project_3",
            fullPath: "Org / Team / Project B",
          },
        ],
        copy: host.copy,
        pushToCopies: host.pushToCopies,
        syncFromSource: async () => ({ ok: true as const }),
        getHistory: host.getHistory,
      }),
    },
  };
});

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

vi.mock("@trpc/client", () => ({
  getUntypedClient: () => host.rpc,
}));

vi.mock("~/components/CascadeArchiveDialog", () => ({
  CascadeArchiveDialog: () => null,
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/ui/layouts/PageLayout", () => ({
  PageLayout: {
    Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
    Heading: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
    HeaderButton: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  },
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (Component: React.ComponentType) => Component,
}));

vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));

// Both symbols now live in the same package, so this is one mock rather than
// two, and it spreads the real module: replacing the whole barrel would strip
// every other export this graph reads from it.
vi.mock("@langwatch/langy-web", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  LangyContextTarget: ({ children }: { children: ReactNode }) => <>{children}</>,
  agentContextChip: () => ({}),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: host.closeDrawer, openDrawer: host.openDrawer }),
  useDrawerParams: () => ({ agentId: "agent_1", agentName: "HTTP agent" }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1", slug: "project" } }),
}));

vi.mock("~/hooks/useProjectsForCopy", () => ({
  useProjectsForCopy: () => [
    { label: "Org / Team / Allowed", value: "project_2", hasCreatePermission: true },
    { label: "Org / Team / No permission", value: "project_3", hasCreatePermission: false },
  ],
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      agents: { getAll: { invalidate: vi.fn() } },
      licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
    }),
    agents: { getAll: { useQuery: () => ({ data: [host.agent], isLoading: false }) } },
  },
  trpcClient: {},
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: host.routerPush }),
}));

vi.mock("~/utils/formatTimeAgo", () => ({ formatTimeAgo: () => "just now" }));

import { trpcQueryFilter, trpcQueryKey } from "@langwatch/platform-api-client";
import AgentUiHost, { AgentHistoryDrawer, PlatformRpcClient } from "../agent-ui-host.adapter";

function renderHost(node: ReactNode = <AgentUiHost />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChakraProvider value={defaultSystem}>{node}</ChakraProvider>
    </QueryClientProvider>,
  );
}

async function openAgentActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Actions for HTTP agent" }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Agent UI host", () => {
  it("wires route actions to the named editor and history drawers", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderHost();

    await user.click(screen.getByTestId("agent-card-agent_1"));
    expect(host.openDrawer).toHaveBeenCalledWith("agentHttpEditor", {
      urlParams: { agentId: "agent_1" },
    });

    await openAgentActions(user);
    await user.click(screen.getByRole("menuitem", { name: /view history/i }));
    expect(host.openDrawer).toHaveBeenCalledWith("agentHistory", {
      urlParams: { agentId: "agent_1", agentName: "HTTP agent" },
    });
  });

  it("uses the real host copy dialog for permitted project selection and cancel", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderHost();

    await openAgentActions(user);
    await user.click(screen.getByRole("menuitem", { name: /replicate/i }));

    expect(screen.getByText("Replicate Agent")).toBeInTheDocument();
    expect(screen.getByText("(no permission)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replicate" })).toBeDisabled();

    await user.click(screen.getByRole("combobox"));
    const disabledProjects = await screen.findAllByRole("option", {
      name: /Org \/ Team \/ No permission/,
      hidden: true,
    });
    const disabledProject = disabledProjects.find((option) => option.tagName === "DIV");
    await user.click(disabledProject!);
    expect(screen.getByRole("button", { name: "Replicate" })).toBeDisabled();

    await user.click(screen.getByRole("combobox"));
    const allowedProjects = await screen.findAllByRole("option", {
      name: /Org \/ Team \/ Allowed/,
      hidden: true,
    });
    const allowedProject = allowedProjects.find((option) => option.tagName === "DIV");
    await user.click(allowedProject!);
    expect(screen.getByRole("button", { name: "Replicate" })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(host.copy).not.toHaveBeenCalled();
  });

  it("replicates to the project selected through the host dialog", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderHost();

    await openAgentActions(user);
    await user.click(screen.getByRole("menuitem", { name: /replicate/i }));
    await user.click(screen.getByRole("combobox"));
    const allowedProjects = await screen.findAllByRole("option", {
      name: /Org \/ Team \/ Allowed/,
      hidden: true,
    });
    await user.click(allowedProjects.find((option) => option.tagName === "DIV")!);
    await user.click(screen.getByRole("button", { name: "Replicate" }));

    await waitFor(() => {
      expect(host.copy).toHaveBeenCalledWith({
        agentId: "agent_1",
        projectId: "project_2",
        sourceProjectId: "project_1",
      });
    });
  });

  it("wires replica selection and push through the real host dialog", async () => {
    const user = userEvent.setup();
    renderHost();

    await openAgentActions(user);
    await user.click(screen.getByRole("menuitem", { name: /push to replicas/i }));

    expect(await screen.findByText("Replica A")).toBeInTheDocument();
    expect(screen.getByText("Replica B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push to 2 replicas" })).toBeEnabled();

    await user.click(screen.getByRole("checkbox", { name: /Replica A/i }));
    expect(screen.getByRole("button", { name: "Push to 1 replica" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Push to 1 replica" }));

    await waitFor(() => {
      expect(host.pushToCopies).toHaveBeenCalledWith({
        agentId: "agent_1",
        projectId: "project_1",
        copyIds: ["copy_2"],
      });
    });
  });

  it("cancels the real replica dialog without pushing", async () => {
    const user = userEvent.setup();
    renderHost();

    await openAgentActions(user);
    await user.click(screen.getByRole("menuitem", { name: /push to replicas/i }));
    expect(await screen.findByText("Replica A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(host.pushToCopies).not.toHaveBeenCalled();
  });

  it("renders history through the composed browser port and closes through the drawer port", async () => {
    const user = userEvent.setup();
    renderHost(<AgentHistoryDrawer />);

    await waitFor(() => {
      expect(host.getHistory).toHaveBeenCalledWith({ agentId: "agent_1", projectId: "project_1" });
    });
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(host.closeDrawer).toHaveBeenCalled();
  });
});

/**
 * The agent's reads have to land in the SAME cache entries the rest of the
 * application uses. They did not: this adapter keyed them under a namespace of
 * its own (`["agent-ui", path, input]`), which shares no prefix with any tRPC
 * key, so an invalidation on either side was invisible to the other and the
 * symptom was stale UI that looked random.
 *
 * These assert the sharing itself rather than the shape of the key — a key
 * whose encoding is right but which nothing else reaches is the bug, not the
 * fix.
 */
describe("the agent's RPC cache", () => {
  describe("given a procedure the agent has read", () => {
    it("is invalidated by a tRPC invalidation naming that procedure", async () => {
      const queryClient = new QueryClient();
      const rpc = new PlatformRpcClient(queryClient);

      await rpc.query("tracesV2.list", { projectId: "project_1" });

      // What `utils.tracesV2.list.invalidate()` does, from anywhere else in
      // the application.
      await queryClient.invalidateQueries(trpcQueryFilter("tracesV2.list"));

      const state = queryClient.getQueryState(
        trpcQueryKey("tracesV2.list", {
          input: { projectId: "project_1" },
          type: "query",
        }) as unknown as readonly unknown[],
      );
      expect(state?.isInvalidated).toBe(true);
    });
  });

  describe("when the agent mutates", () => {
    it("invalidates what the application cached, not only its own reads", async () => {
      const queryClient = new QueryClient();
      const rpc = new PlatformRpcClient(queryClient);

      // Seeded the way an application hook would, never through the agent.
      const appKey = trpcQueryKey("tracesV2.list", {
        input: { projectId: "project_1" },
        type: "query",
      }) as unknown as readonly unknown[];
      queryClient.setQueryData(appKey, { rows: [] });

      await rpc.mutate("tracesV2.delete", { id: "trace_1" });

      expect(queryClient.getQueryState(appKey)?.isInvalidated).toBe(true);
    });
  });
});
