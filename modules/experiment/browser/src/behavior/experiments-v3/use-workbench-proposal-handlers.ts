/**
 * What this page does when the reader applies one of Langy's proposals, one hook
 * per domain; the page merges them for `useRegisterLangyHandlers`.
 */
import { useDrawer } from "@langwatch/browser-host/drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { generate } from "@langwatch/ksuid";
import type { ProposalHandlers } from "@langwatch/langy-browser-kit";
import { useMemo } from "react";

import type { EvaluationsV3Store } from "../../model/experiments-v3/types.ts";
import { experimentApi } from "../experiment-api.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";

/** The app's KSUID resource for a workbench evaluator id (`KSUID_RESOURCES.EVALUATOR`). */
const EVALUATOR_KSUID_RESOURCE = "evaluator";
/** The app's KSUID resource for a dataset record row (`KSUID_RESOURCES.RECORD`). */
const RECORD_KSUID_RESOURCE = "record";

type PromptMessage = { role: "system" | "user" | "assistant"; content: string };

/** A prompt update carrying only the fields the proposal set. */
const promptUpdateData = ({
  commitMessage,
  messages,
  model,
  temperature,
  maxTokens,
}: {
  commitMessage: string;
  messages?: PromptMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}) => ({
  commitMessage,
  ...(messages ? { messages } : {}),
  ...(model ? { model } : {}),
  ...(temperature !== undefined ? { temperature } : {}),
  ...(maxTokens !== undefined ? { maxTokens } : {}),
});

type WorkbenchProposalDeps = {
  addEvaluator: EvaluationsV3Store["addEvaluator"];
  executeEvaluation: (scope: { type: "full" }) => Promise<void>;
};

/** Langy's evaluator proposals, applied from this page. */
export const useEvaluatorProposalHandlers = (): ProposalHandlers => {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const createEvaluator = experimentApi.evaluators.create.useMutation();
  const updateEvaluator = experimentApi.evaluators.update.useMutation();
  const deleteEvaluator = experimentApi.evaluators.delete.useMutation();
  const utils = experimentApi.useUtils();
  return useMemo<ProposalHandlers>(() => {
    const projectId = project?.id;
    if (!projectId) return {} as ProposalHandlers;
    return {
      "evaluators.create": async (payload) => {
        const { name, type, config } = payload as {
          name: string;
          type: "evaluator" | "workflow";
          config: Record<string, unknown>;
        };
        const created = await createEvaluator.mutateAsync({
          projectId,
          name,
          type,
          config,
        });
        await utils.evaluators.getAll.invalidate({ projectId });
        const evaluatorType = (
          created?.config as {
            evaluatorType?: string;
          } | null
        )?.evaluatorType;
        return {
          label: "Edit evaluator",
          onOpen: () =>
            openDrawer("evaluatorEditor", {
              evaluatorId: created.id,
              evaluatorType,
            }),
        };
      },
      "evaluators.update": async (payload) => {
        const { id, name, config, evaluatorType } = payload as {
          id: string;
          name?: string;
          config: Record<string, unknown>;
          evaluatorType?: string;
        };
        await updateEvaluator.mutateAsync({
          projectId,
          id,
          ...(name ? { name } : {}),
          config,
        });
        await utils.evaluators.getAll.invalidate({ projectId });
        return {
          label: "Edit evaluator",
          onOpen: () =>
            openDrawer("evaluatorEditor", {
              evaluatorId: id,
              evaluatorType,
            }),
        };
      },
      "evaluators.delete": async (payload) => {
        const { id } = payload as { id: string };
        await deleteEvaluator.mutateAsync({ projectId, id });
        await utils.evaluators.getAll.invalidate({ projectId });
        // Drop any workbench columns that referenced the archived evaluator
        // so the table reflects the delete immediately.
        const current = useEvaluationsV3Store.getState().evaluators;
        for (const entry of current) {
          if (entry.dbEvaluatorId === id) {
            useEvaluationsV3Store.getState().removeEvaluator(entry.id);
          }
        }
        return undefined;
      },
    };
  }, [project?.id, createEvaluator, updateEvaluator, deleteEvaluator, utils, openDrawer]);
};

/** Langy's workbench proposals, applied from this page. */
export const useWorkbenchProposalHandlers = ({
  addEvaluator,
  executeEvaluation,
}: WorkbenchProposalDeps): ProposalHandlers => {
  const { project } = useOrganizationTeamProject();
  return useMemo<ProposalHandlers>(() => {
    const projectId = project?.id;
    if (!projectId) return {} as ProposalHandlers;
    return {
      "workbench.addEvaluator": async (payload) => {
        const { dbEvaluatorId, evaluatorType, name, fields } = payload as {
          dbEvaluatorId: string;
          evaluatorType: string;
          name: string;
          fields: { identifier: string; type: string; optional?: boolean }[];
        };
        addEvaluator({
          id: generate(EVALUATOR_KSUID_RESOURCE).toString(),
          evaluatorType: evaluatorType as never,
          inputs: fields as never,
          dbEvaluatorId,
          mappings: {},
          localEvaluatorConfig: { name },
        });
      },
      "workbench.run": async () => {
        // Fire-and-forget: the eval run can take minutes. Apply should
        // confirm immediately; progress is visible in the workbench
        // header.
        void executeEvaluation({ type: "full" });
      },
    };
  }, [project?.id, addEvaluator, executeEvaluation]);
};

/** Langy's prompt proposals, applied from this page. */
export const usePromptProposalHandlers = (): ProposalHandlers => {
  const { project } = useOrganizationTeamProject();
  const createPrompt = experimentApi.prompts.create.useMutation();
  const updatePrompt = experimentApi.prompts.update.useMutation();
  const utils = experimentApi.useUtils();
  return useMemo<ProposalHandlers>(() => {
    const projectId = project?.id;
    const projectSlug = project?.slug;
    if (!projectId) return {} as ProposalHandlers;
    return {
      "prompts.create": async (payload) => {
        const { handle, messages, model, temperature, maxTokens } = payload as {
          handle: string;
          messages: {
            role: "system" | "user" | "assistant";
            content: string;
          }[];
          model?: string;
          temperature?: number;
          maxTokens?: number;
        };
        await createPrompt.mutateAsync({
          projectId,
          data: { handle, messages, model, temperature, maxTokens },
        });
        await utils.prompts.getAllPromptsForProject.invalidate({ projectId });
        return projectSlug ? { href: `/${projectSlug}/prompts`, label: "Open prompt" } : undefined;
      },
      "prompts.update": async (payload) => {
        const { id, commitMessage, messages, model, temperature, maxTokens } = payload as {
          id: string;
          commitMessage: string;
          messages?: {
            role: "system" | "user" | "assistant";
            content: string;
          }[];
          model?: string;
          temperature?: number;
          maxTokens?: number;
        };
        await updatePrompt.mutateAsync({
          projectId,
          id,
          data: promptUpdateData({ commitMessage, messages, model, temperature, maxTokens }),
        });
        await utils.prompts.getAllPromptsForProject.invalidate({ projectId });
        return projectSlug ? { href: `/${projectSlug}/prompts`, label: "Open prompt" } : undefined;
      },
    };
  }, [project?.id, project?.slug, createPrompt, updatePrompt, utils]);
};

/** Langy's dataset proposals, applied from this page. */
export const useDatasetProposalHandlers = (): ProposalHandlers => {
  const { project } = useOrganizationTeamProject();
  const upsertDataset = experimentApi.dataset.upsert.useMutation();
  const createDatasetRecords = experimentApi.datasetRecord.create.useMutation();
  const utils = experimentApi.useUtils();
  return useMemo<ProposalHandlers>(() => {
    const projectId = project?.id;
    const projectSlug = project?.slug;
    if (!projectId) return {} as ProposalHandlers;
    return {
      "datasets.create": async (payload) => {
        const { name, columnTypes, initialRows } = payload as {
          name: string;
          columnTypes: { name: string; type: string }[];
          initialRows?: Record<string, unknown>[];
        };
        const created = await upsertDataset.mutateAsync({
          projectId,
          name,
          columnTypes: columnTypes as never,
          ...(initialRows && initialRows.length > 0
            ? {
                datasetRecords: initialRows.map((row) => ({
                  id: generate(RECORD_KSUID_RESOURCE).toString(),
                  entry: row,
                })) as never,
              }
            : {}),
        });
        await utils.dataset.getAll.invalidate({ projectId });
        return projectSlug && created?.id
          ? {
              href: `/${projectSlug}/datasets/${created.id}`,
              label: "Open dataset",
            }
          : undefined;
      },
      "datasets.addRows": async (payload) => {
        const { datasetId, rows } = payload as {
          datasetId: string;
          rows: Record<string, unknown>[];
        };
        await createDatasetRecords.mutateAsync({
          projectId,
          datasetId,
          entries: rows.map((row) => ({
            id: generate(RECORD_KSUID_RESOURCE).toString(),
            ...row,
          })) as never,
        });
        await utils.dataset.getAll.invalidate({ projectId });
        return projectSlug
          ? {
              href: `/${projectSlug}/datasets/${datasetId}`,
              label: "Open dataset",
            }
          : undefined;
      },
    };
  }, [project?.id, project?.slug, upsertDataset, createDatasetRecords, utils]);
};
