import { api, type RouterInputs } from "../scenario-api.ts";

type SuiteKinds = RouterInputs["suites"]["getAll"]["kinds"];

/** The project's run plans and test suites, narrowed to the kinds a surface reads. */
export function useSuites({
  projectId,
  kinds,
  enabled = true,
}: {
  projectId: string | undefined;
  kinds?: SuiteKinds;
  enabled?: boolean;
}) {
  return api.suites.getAll.useQuery(
    { projectId: projectId ?? "", kinds },
    { enabled: !!projectId && enabled },
  );
}
