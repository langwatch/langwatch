import { evaluatorClient } from "@langwatch/evaluator-client";

/** The deploy labels an evaluator carries and its newest version, for a label picker. */
export function useEvaluatorLabelOptions(input: {
  projectId: string | undefined;
  evaluatorId: string | undefined;
}): { labels: { label: string; version: number }[]; latestVersion: number | null } {
  const { projectId, evaluatorId } = input;
  const query = evaluatorClient.evaluators.listVersions.useQuery(
    { projectId: projectId ?? "", evaluatorId: evaluatorId ?? "" },
    { enabled: !!projectId && !!evaluatorId },
  );
  return {
    labels: (query.data?.labels ?? []).map(({ label, version }) => ({ label, version })),
    latestVersion: query.data?.versions[0]?.version ?? null,
  };
}
