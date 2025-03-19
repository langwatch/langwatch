import { useFilterParams } from "../../hooks/useFilterParams";
import type { MappingState } from "../../server/tracer/tracesMapping";
import { api } from "../../utils/api";
import { TracesMapping } from "../traces/TracesMapping";

export function EvaluatorTracesMapping({
  titles,
  fields,
  mappings,
  setMapping,
}: {
  titles?: string[];
  fields: string[];
  mappings: MappingState;
  setMapping: (mapping: MappingState) => void;
}) {
  const { filterParams, queryOpts } = useFilterParams();
  const recentTraces = api.traces.getSampleTracesDataset.useQuery(
    filterParams,
    queryOpts
  );

  if (!mappings?.mapping) {
    return null;
  }

  return (
    <TracesMapping
      titles={titles}
      mapping={mappings}
      traces={recentTraces.data ?? []}
      // TODO: specify optional/required fields
      fields={fields}
      setDatasetMapping={setMapping}
      disableExpansions
    />
  );
}
