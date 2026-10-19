import { api } from "../scenario-api.ts";

/** One run plan or test suite by id, read only while there is an id to read. */
export function useSuite({
  projectId,
  id,
  enabled = true,
}: {
  projectId: string | undefined;
  id: string | undefined;
  enabled?: boolean;
}) {
  return api.suites.getById.useQuery(
    { projectId: projectId ?? "", id: id ?? "" },
    { enabled: !!projectId && !!id && enabled },
  );
}
