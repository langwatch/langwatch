/** The connector editor's module doubles, imported by each test's `vi.mock` factory. */

import { vi } from "vitest";

export const connectorState: {
  flagOn: boolean;
  agentById:
    | { id: string; name: string; type: string; config: Record<string, unknown> }
    | undefined;
  secrets: readonly { name: string }[];
  datasets: readonly { id: string; name: string }[];
} = { flagOn: true, agentById: void 0, secrets: [], datasets: [] };

export const createMock = vi.fn();
export const updateMock = vi.fn();

export const agentApiDouble = {
  agentApi: {
    agents: {
      getById: { useQuery: () => ({ data: connectorState.agentById, isLoading: false }) },
      create: { useMutation: () => ({ mutate: createMock, isPending: false }) },
      update: { useMutation: () => ({ mutate: updateMock, isPending: false }) },
    },
    secrets: { list: { useQuery: () => ({ data: connectorState.secrets }) } },
    useUtils: () => ({
      agents: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
        listVersions: { invalidate: vi.fn() },
        getHistory: { invalidate: vi.fn() },
      },
    }),
  },
};

export const datasetClientDouble = {
  datasetClient: {
    dataset: { getAll: { useQuery: () => ({ data: connectorState.datasets }) } },
  },
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
