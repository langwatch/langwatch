import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { api } from "../utils/api";
import { isNotFound } from "../utils/trpcError";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

export function useTraceDetailsState(traceId: string) {
  const router = useRouter();
  const spanId =
    typeof router.query.span === "string" ? router.query.span : undefined;
  const openTab =
    typeof router.query.openTab === "string" ? router.query.openTab : undefined;
  const { project } = useOrganizationTeamProject();

  const [keepRefetching, setKeepRefetching] = useState(true);

  let trace = api.traces.getById.useQuery(
    { projectId: project?.id ?? "", traceId: traceId },
    {
      enabled: !!project && !!traceId,
      refetchOnWindowFocus: true,
      refetchInterval: keepRefetching ? 5000 : undefined,
    },
  );

  useEffect(() => {
    if (trace.data) {
      setKeepRefetching(false);
      return;
    }

    const timeout = setTimeout(() => {
      setKeepRefetching(false);
    }, 10_000);
    return () => clearTimeout(timeout);
  }, [trace.data]);

  if (isNotFound(trace.error) && keepRefetching) {
    trace = {
      ...trace,
      data: undefined,
      error: undefined,
      isLoading: true,
      isError: false,
    } as any;
  }

  return { traceId, spanId, trace, openTab };
}
