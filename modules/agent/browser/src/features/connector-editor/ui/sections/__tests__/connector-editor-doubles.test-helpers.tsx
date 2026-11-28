/** The connector editor's module doubles, imported by each test's `vi.mock` factory. */

import type { datasetClient } from "@langwatch/dataset-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

import type { agentApi } from "../../../../../behavior/agent-api.ts";

type AgentApi = typeof agentApi;
type Agents = AgentApi["agents"];
type DatasetClient = typeof datasetClient;

type SavedAgentRow = { id: string; name: string; type: string; config: Record<string, unknown> };

export const connectorState: {
  flagOn: boolean;
  agentById: SavedAgentRow | undefined;
  /** Set to fail the saved connector's read. */
  agentByIdError: Error | undefined;
  /** A save in flight, as the mutation reports it. */
  savePending: boolean;
  secrets: readonly { name: string }[];
  datasets: readonly { id: string; name: string }[];
} = {
  flagOn: true,
  agentById: void 0,
  agentByIdError: void 0,
  savePending: false,
  secrets: [],
  datasets: [],
};

/** What a save answers: the stored agent, at once unless a test holds it back. */
export const createMock = vi.fn(async (input: { name: string }) => ({ id: "agent_new", ...input }));
export const updateMock = vi.fn(async (input: { id: string; name: string }) => input);
export const refetchAgentMock = vi.fn();

const mutation = (mutateAsync: unknown) =>
  (() => ({ mutateAsync, isPending: connectorState.savePending })) as never;

export const agentApiDouble = {
  agentApi: createApiFixture<AgentApi>(
    {
      agents: createApiFixture<Agents>(
        {
          getById: createApiFixture<Agents["getById"]>({
            useQuery: (() => ({
              data: connectorState.agentById,
              isLoading: false,
              isError: connectorState.agentByIdError !== undefined,
              error: connectorState.agentByIdError ?? null,
              refetch: refetchAgentMock,
            })) as never,
          }),
          create: createApiFixture<Agents["create"]>({ useMutation: mutation(createMock) }),
          update: createApiFixture<Agents["update"]>({ useMutation: mutation(updateMock) }),
        },
        "agentApi.agents",
      ),
      secrets: createApiFixture<AgentApi["secrets"]>(
        {
          list: createApiFixture<AgentApi["secrets"]["list"]>({
            useQuery: (() => ({ data: connectorState.secrets })) as never,
          }),
        },
        "agentApi.secrets",
      ),
      useUtils: (() => ({
        agents: {
          getAll: { invalidate: vi.fn() },
          getById: { invalidate: vi.fn() },
          listVersions: { invalidate: vi.fn() },
          getHistory: { invalidate: vi.fn() },
        },
      })) as never,
    },
    "agentApi",
  ),
};

export const datasetClientDouble = {
  datasetClient: createApiFixture<DatasetClient>(
    {
      dataset: createApiFixture<DatasetClient["dataset"]>(
        {
          getAll: createApiFixture<DatasetClient["dataset"]["getAll"]>({
            useQuery: (() => ({ data: connectorState.datasets })) as never,
          }),
        },
        "datasetClient.dataset",
      ),
    },
    "datasetClient",
  ),
};

/** Stands in for Monaco: a plain text area over the block being edited. */
export const codeEditorDouble = {
  WorkflowCodeEditorModal: ({
    open,
    code,
    setCode,
    onClose,
  }: {
    open: boolean;
    code: string;
    setCode: (code: string) => void;
    onClose: () => void;
  }) =>
    open ? (
      <div>
        <textarea
          aria-label="Block code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button type="button" onClick={onClose}>
          Close editor
        </button>
      </div>
    ) : null,
};

export const codePreviewDouble = {
  CodePreview: ({ code }: { code: string }) => <pre>{code}</pre>,
};

export const SAVED_CONNECTOR = {
  id: "agent_shop",
  name: "Shop connector",
  type: "connector",
  config: {
    setup: { language: "python", code: "class Code:\n    # make the account\n" },
    call: { language: "python", code: "class Code:\n    # call the shop\n" },
    teardown: { language: "python", code: "class Code:\n    # remove the account\n" },
    secretNames: ["SHOP_ADMIN_KEY"],
    fixturesDatasetId: "dataset_orders",
    timeoutMs: 30_000,
  },
};
