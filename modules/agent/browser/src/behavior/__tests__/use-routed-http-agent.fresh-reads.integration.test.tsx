/**
 * A saved HTTP agent reads fresh in the tab that saved it: the real tRPC hooks over a network the
 * test answers, with production's query client and its five-minute trust.
 * @vitest-environment jsdom
 * Spec: modules/agent/specs/agent-versioning.feature
 */
import { createUiQueryClient } from "@langwatch/browser/query-client";
import { answeringUiTransport, type UiProcedureCall } from "@langwatch/browser/testing-transport";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/drawer", () => ({ getDrawerStack: () => [] }));
vi.mock("../../model/agent-management-host.ts", () => ({
  useAgentManagementHost: () => ({
    project: () => ({ id: "project_1", slug: "acme" }),
    failed: vi.fn(),
  }),
}));
vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    scenarios: { testHttpAgent: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

const { agentApi } = await import("../agent-api.ts");
const { useRoutedHttpAgent } = await import("../use-routed-http-agent.ts");

const OLD_URL = "https://old.example.test/chat";
const NEW_URL = "https://new.example.test/chat";
const projectId = "project_1";

/** One stored HTTP agent that the answers read and the update rewrites, as the server would. */
function storedAgent() {
  const stored = { url: OLD_URL, version: 1 };
  const row = () => ({
    id: "agent_1",
    projectId,
    name: "Support bot",
    type: "http",
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    config: { name: "Support bot", url: stored.url, method: "POST" },
    inputFields: [],
    outputFields: [],
    fieldsResolved: true,
    version: stored.version,
  });
  const calls: string[] = [];
  const answer = async ({ path, input }: UiProcedureCall): Promise<unknown> => {
    calls.push(path);
    if (path === "agents.getById" || path === "agents.update") {
      if (path === "agents.update") {
        const { config } = input as { config: { url: string } };
        stored.url = config.url;
        stored.version += 1;
      }
      return row();
    }
    if (path === "agents.getAll") return [row()];
    if (path === "agents.listVersions") {
      return {
        versions: Array.from({ length: stored.version }, (_, index) => ({
          version: stored.version - index,
        })),
        labels: [],
        availableLabels: [],
      };
    }
    throw new Error(`unexpected ${path}`);
  };
  return { answer, calls };
}

function mount() {
  const server = storedAgent();
  const queryClient = createUiQueryClient({ onMutationError: () => void 0 });
  const client = answeringUiTransport(server.answer);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <agentApi.Provider client={client} queryClient={queryClient}>
      {children}
    </agentApi.Provider>
  );
  const view = renderHook(
    () => ({
      editor: useRoutedHttpAgent({ agentId: "agent_1", close: vi.fn() }),
      list: agentApi.agents.getAll.useQuery({ projectId }),
      versions: agentApi.agents.listVersions.useQuery({ projectId, agentId: "agent_1" }),
    }),
    { wrapper },
  );
  return { ...view, server };
}

const urlOf = (agent: unknown) => (agent as { config?: { url?: string } } | null)?.config?.url;

describe("saving an HTTP agent's URL", () => {
  /** @scenario "A saved URL change shows at once in the tab that saved it" */
  it("reads the agent, the list and the versions again with the new URL", async () => {
    const { result } = mount();
    await waitFor(() => {
      expect(urlOf(result.current.editor.options.agent)).toBe(OLD_URL);
      expect(result.current.versions.data?.versions).toHaveLength(1);
    });

    await act(async () => {
      await result.current.editor.options.onUpdate({
        id: "agent_1",
        projectId,
        name: "Support bot",
        config: { name: "Support bot", url: NEW_URL, method: "POST" },
      });
    });

    await waitFor(() => {
      expect(urlOf(result.current.editor.options.agent)).toBe(NEW_URL);
      expect(urlOf(result.current.list.data?.[0])).toBe(NEW_URL);
      expect(result.current.versions.data?.versions).toHaveLength(2);
    });
  });
});
