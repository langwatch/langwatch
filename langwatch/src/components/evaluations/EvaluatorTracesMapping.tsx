import { useFilterParams } from "../../hooks/useFilterParams";
import { api } from "../../utils/api";
import { TracesMapping } from "../traces/TracesMapping";

export function EvaluatorTracesMapping(
  props: Omit<React.ComponentProps<typeof TracesMapping>, "traces">
) {
  const { filterParams, queryOpts } = useFilterParams();
  const recentTraces = api.traces.getSampleTracesDataset.useQuery(
    filterParams,
    queryOpts
  );

  if (props.traceMapping && !props.traceMapping?.mapping) {
    return null;
  }

  return <TracesMapping {...props} traces={recentTraces.data ?? []} />;
}
