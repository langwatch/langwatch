import { useMemo } from "react";
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

  const mappingColumns = useMemo(() => {
    return fields.map((field) => ({
      name: field,
      type: "string" as const,
    }));
  }, [fields]);

  if (!mappings?.mapping) {
    return null;
  }

  return (
    <TracesMapping
      titles={titles}
      dataset={{
        mapping: mappings,
      }}
      traces={recentTraces.data ?? []}
      // TODO: specify optional/required fields
      columnTypes={mappingColumns}
      setDatasetMapping={setMapping}
    />
  );
}
