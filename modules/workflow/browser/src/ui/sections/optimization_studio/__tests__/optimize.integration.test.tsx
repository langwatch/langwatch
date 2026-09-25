/**
 * @vitest-environment jsdom
 * Characterizes starting an optimization: the entry limits, the version it runs on, and failures.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/studio-dialog";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPTIMIZERS } from "../../../../model/optimizers.ts";

const state = vi.hoisted(() => ({
  total: 100,
  canSave: true,
  currentVersionId: undefined as string | undefined,
  commits: [] as unknown[],
  started: [] as unknown[],
  toasts: [] as { title?: string; type?: string }[],
  currentVersionIds: [] as string[],
}));

const WORKFLOW = {
  nodes: [
    {
      id: "entry",
      type: "entry",
      data: { dataset: { id: "ds" }, train_size: 0.8, test_size: 0.2 },
    },
    { id: "judge", type: "evaluator", data: {} },
  ],
  edges: [],
};

vi.mock("../../../../behavior/use-workflow-store.ts", () => ({
  useWorkflowStore: (selector: (store: unknown) => unknown) =>
    selector({
      workflow_id: "wf-1",
      getWorkflow: () => WORKFLOW,
      nodes: WORKFLOW.nodes,
      state: { optimization: undefined },
      deselectAllNodes: () => undefined,
      setOpenResultsPanelRequest: () => undefined,
      setLastCommittedWorkflow: () => undefined,
      setCurrentVersionId: (id: string) => state.currentVersionIds.push(id),
      currentVersionId: state.currentVersionId,
      checkCanCommitNewVersion: () => state.canSave,
    }),
}));
vi.mock("../../../../behavior/studio-host/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));
vi.mock("../../../../behavior/optimization_studio/use-get-dataset-data.ts", () => ({
  useGetDatasetData: () => ({ total: state.total }),
}));
vi.mock("../../../../behavior/optimization_studio/use-model-provider-keys.ts", () => ({
  useModelProviderKeys: () => ({
    hasProvidersWithoutCustomKeys: false,
    nodeProvidersWithoutCustomKeys: [],
  }),
}));
vi.mock("../use-version-state.ts", () => ({
  useVersionState: () => ({ versions: { data: [], refetch: async () => undefined } }),
}));
vi.mock("../use-optimization-execution.ts", () => ({
  useOptimizationExecution: () => ({
    startOptimizationExecution: (input: unknown) => state.started.push(input),
  }),
}));
vi.mock("../version-to-be-used.tsx", () => ({ VersionToBeUsed: () => null }));
vi.mock("../properties/llm-configs/optimization-studio-llm-config-field.tsx", () => ({
  OptimizationStudioLLMConfigField: () => null,
}));
vi.mock("../../../elements/optimization_studio/add-model-provider-key.tsx", () => ({
  AddModelProviderKey: () => null,
}));
vi.mock("@langwatch/browser-host/toaster", () => ({
  toaster: { create: (toast: { title?: string; type?: string }) => state.toasts.push(toast) },
}));
vi.mock("@langwatch/browser-trpc/workflow-api", () => ({
  api: {
    workflow: {
      commitVersion: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            state.commits.push(input);
            return { id: "v-new" };
          },
        }),
      },
    },
  },
}));

const { OptimizeModalContent } = await import("../optimize.tsx");

type OptimizeForm =
  Parameters<typeof OptimizeModalContent>[0]["form"] extends UseFormReturn<infer Form>
    ? Form
    : never;

function Harness() {
  const form = useForm<OptimizeForm>({
    defaultValues: {
      version: "1.1",
      commitMessage: "Tune prompts",
      optimizer: { label: "MIPRO", value: "MIPROv2" },
      params: OPTIMIZERS.MIPROv2.params,
    },
  });
  return (
    <ChakraProvider value={defaultSystem}>
      <Dialog.Root open>
        <OptimizeModalContent form={form} onClose={() => undefined} />
      </Dialog.Root>
    </ChakraProvider>
  );
}

async function submit() {
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: /Run Optimization/ }));
}

beforeEach(() => {
  Object.assign(state, {
    total: 100,
    canSave: true,
    currentVersionId: undefined,
    commits: [],
    started: [],
    toasts: [],
    currentVersionIds: [],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OptimizeModalContent", () => {
  describe("when a new version can be saved", () => {
    it("commits the version and starts the optimization on it", async () => {
      await submit();

      await waitFor(() => expect(state.started).toHaveLength(1));
      expect(state.commits).toEqual([
        {
          projectId: "proj-1",
          workflowId: "wf-1",
          commitMessage: "Tune prompts",
          dsl: { ...WORKFLOW, version: "1.1" },
        },
      ]);
      expect(state.currentVersionIds).toEqual(["v-new"]);
      expect(state.toasts.map(({ title }) => title)).toEqual(["Version saved"]);
      expect(state.started[0]).toMatchObject({
        workflow_version_id: "v-new",
        optimizer: "MIPROv2",
      });
    });
  });

  describe("when the current version is reused", () => {
    it("starts the optimization on the current version without committing", async () => {
      state.canSave = false;
      state.currentVersionId = "v-cur";
      await submit();

      await waitFor(() => expect(state.started).toHaveLength(1));
      expect(state.commits).toEqual([]);
      expect(state.started[0]).toMatchObject({ workflow_version_id: "v-cur" });
    });

    it("reports a missing version id and starts nothing", async () => {
      state.canSave = false;
      await submit();

      await waitFor(() => expect(state.toasts).toHaveLength(1));
      expect(state.toasts[0]).toMatchObject({
        title: "Version ID not found for optimization",
        type: "error",
      });
      expect(state.started).toEqual([]);
    });
  });

  describe("when the optimization set is large", () => {
    it("asks to confirm and stops when declined", async () => {
      state.total = 400;
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      await submit();

      await waitFor(() =>
        expect(confirm).toHaveBeenCalledWith("Going to optimize on 320 entries. Are you sure?"),
      );
      expect(state.commits).toEqual([]);
      expect(state.started).toEqual([]);
    });

    it("refuses beyond the 3000 entry limit after the confirm", async () => {
      state.total = 4000;
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
      await submit();

      await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
      expect(state.commits).toEqual([]);
      expect(state.started).toEqual([]);
    });
  });

  describe("when MIPRO v2 is chosen", () => {
    it("shows its teacher LLM and tuning fields", async () => {
      render(<Harness />);

      expect(await screen.findByText("Teacher LLM")).toBeTruthy();
      expect(screen.getByText("Number of Candidate Prompts")).toBeTruthy();
      expect(screen.getByText("Max Bootstrapped Demos")).toBeTruthy();
      expect(screen.getByText("Max Labeled Demos")).toBeTruthy();
      expect(screen.getByText("80 optimization set entries")).toBeTruthy();
    });
  });

  describe("when there are too few entries", () => {
    it("disables the optimize button", async () => {
      state.total = 10;
      render(<Harness />);

      expect(await screen.findByRole("button", { name: /Run Optimization/ })).toBeDisabled();
    });
  });
});
