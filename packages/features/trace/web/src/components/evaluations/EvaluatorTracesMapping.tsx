import { useFilterParams } from "../../behavior/use-filter-params";
import { api } from "../../behavior/trace-api";
import { TracesMapping } from "../traces/TracesMapping";

/**
 * The mapping an evaluator is set up with. Evaluations run against the trace as
 * it was captured, so neither the samples this reads nor the thread behind them
 * take the reviewer's corrections: `shouldApplyCorrections` is not on offer.
 */
export function EvaluatorTracesMapping(
  props: Omit<
    React.ComponentProps<typeof TracesMapping>,
    "traces" | "shouldApplyCorrections"
  >,
) {
  const { filterParams, queryOpts } = useFilterParams();
  const recentTraces = api.traces.getSampleTracesDataset.useQuery(
    filterParams,
    queryOpts,
  );

  if (props.traceMapping && !props.traceMapping?.mapping) {
    return null;
  }

  return <TracesMapping {...props} traces={recentTraces.data ?? []} />;
}
