import { api } from "../scenario-api.ts";

/** The project's test suites; the one read every scenario surface shares. */
export function useTestSuites({
  projectId,
  enabled = true,
}: {
  projectId: string | undefined;
  enabled?: boolean;
}) {
  return api.suites.testSuites.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && enabled },
  );
}
