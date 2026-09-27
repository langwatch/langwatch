/**
 * Drawers opened by address carry only the address; each reads what it draws itself.
 * @vitest-environment jsdom
 * @see specs/features/agents/connected-agents-ui.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const drawer = vi.hoisted(() => ({ closeDrawer: vi.fn(), goBack: vi.fn() }));
const listed = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ ...drawer, openDrawer: vi.fn(), canGoBack: false }),
}));

vi.mock("../../../model/agent-management-host.ts", () => ({
  useAgentManagementHost: () => ({ project: () => ({ id: "project_1", slug: "acme" }) }),
}));

vi.mock("../../../behavior/agent-api.ts", () => ({
  agentApi: {
    agents: {
      getAll: { useQuery: () => ({ data: listed.rows, isLoading: false }) },
      testTurn: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
  },
}));

vi.mock("../../../behavior/lent-parameter-line-field.tsx", () => ({
  ParameterLineField: () => null,
}));

vi.mock("@langwatch/design-system/shiki", () => ({
  useShikiAdapter: () => ({
    loadContextSync: () => ({}),
    getHighlighter:
      () =>
      ({ code }: { code: string }) => ({ highlighted: false, code }),
  }),
}));

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const { RoutedConnectFromCodeDrawer, RoutedConnectedAgentDrawer } =
  await import("../routed-agent-drawers.tsx");

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
  listed.rows = [];
  drawer.closeDrawer.mockReset();
});

describe("the connected agent drawer opened by address", () => {
  it("reads the agent its address names and closes itself", async () => {
    listed.rows = [
      {
        id: "agent_1",
        name: "support-agent",
        type: "connected",
        environment: "production",
        hostLabel: null,
        lastSeenAt: null,
        status: "online",
        instances: [],
        owner: null,
        selectable: true,
        notSelectableReason: null,
        parameters: [{ name: "model", type: "string" }],
        config: {},
      },
    ];
    render(<RoutedConnectedAgentDrawer agentId="agent_1" />, { wrapper });

    expect(screen.getByRole("heading", { name: "support-agent" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("connected-agent-parameters")).getByText("model"),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId("connected-agent-close"));
    expect(drawer.closeDrawer).toHaveBeenCalled();
  });
});

describe("the connect-from-code drawer opened by address", () => {
  it("draws its snippets with copy buttons of its own", async () => {
    render(<RoutedConnectFromCodeDrawer />, { wrapper });

    expect(await screen.findAllByRole("button", { name: /copy/i })).not.toHaveLength(0);
    expect(screen.getByTestId("connect-agent-listening")).toBeInTheDocument();
  });
});
