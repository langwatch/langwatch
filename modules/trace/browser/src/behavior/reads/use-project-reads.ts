import { apiKeyClient } from "@langwatch/api-key-client";
import { datasetClient } from "@langwatch/dataset-client";
import { evaluatorClient } from "@langwatch/evaluator-client";
import { promptClient } from "@langwatch/prompt-client";

import { api } from "../trace-api.ts";

export function useDatasets({ projectId }: { projectId: string | undefined }) {
  return datasetClient.dataset.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
}

export function usePromptsForProject({
  projectId,
  enabled = true,
}: {
  projectId: string | undefined;
  enabled?: boolean;
}) {
  return promptClient.prompts.getAllPromptsForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && enabled },
  );
}

export function useDataPrivacySnapshot({ projectId }: { projectId: string | undefined }) {
  return api.dataPrivacy.getSnapshot.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, retry: false },
  );
}

export function useSetupSkillPrompt({
  projectId,
  skill,
  enabled,
}: {
  projectId: string | undefined;
  skill: string | undefined;
  enabled: boolean;
}) {
  return api.setupSkills.getPrompt.useQuery(
    { projectId: projectId!, skill: skill! },
    { enabled: enabled && !!skill && !!projectId },
  );
}

export function useStoredObjectHead({
  projectId,
  id,
  enabled,
}: {
  projectId: string;
  id: string | undefined;
  enabled: boolean;
}) {
  return api.storedObjects.headById.useQuery(
    { projectId, id: id ?? "" },
    { enabled: enabled && !!id && !!projectId },
  );
}

export function useApiKeyName({
  organizationId,
  apiKeyId,
  enabled,
}: {
  organizationId: string;
  apiKeyId: string;
  enabled: boolean;
}) {
  return apiKeyClient.apiKey.nameById.useQuery(
    { organizationId, apiKeyId },
    { enabled: !!organizationId && !!apiKeyId && enabled, retry: false },
  );
}

export function useEvaluatorRead({
  projectId,
  id,
  enabled,
}: {
  projectId: string | undefined;
  id: string | undefined;
  enabled: boolean;
}) {
  return evaluatorClient.evaluators.getById.useQuery(
    { id: id ?? "", projectId: projectId ?? "" },
    { enabled: enabled && !!id && !!projectId },
  );
}

export function useMonitorRead({
  projectId,
  id,
  enabled,
}: {
  projectId: string | undefined;
  id: string | undefined;
  enabled: boolean;
}) {
  return api.monitors.getById.useQuery(
    { id: id ?? "", projectId: projectId ?? "" },
    { enabled: enabled && !!id && !!projectId },
  );
}

/** One read consumes one view of the share link, so it must never refetch on its own. */
export function useSharedTraceRead({ token }: { token: string }) {
  return api.sharedTrace.get.useQuery(
    { token },
    {
      enabled: !!token,
      staleTime: Infinity,
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );
}
