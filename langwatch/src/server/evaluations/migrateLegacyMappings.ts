import type { MappingState } from "../tracer/tracesMapping";

export const migrateLegacyMappings = (
  mappings: Record<string, string>
): MappingState => {
  if (mappings.mapping) {
    return mappings as any as MappingState;
  }

  const LEGACY_EVALUATOR_MAPPING_OPTIONS: Record<
    string,
    MappingState["mapping"][number]
  > = {
    spans: {
      source: "spans",
    },
    "trace.input": {
      source: "input",
    },
    "trace.output": {
      source: "output",
    },
    "trace.first_rag_context": {
      source: "contexts",
    },
    "metadata.expected_output": {
      source: "metadata",
      key: "expected_output",
    },
    "metadata.expected_contexts": {
      source: "metadata",
      key: "expected_contexts",
    },
  };

  return {
    mapping: Object.fromEntries(
      Object.entries(mappings).map(([key, value]) => [
        key,
        LEGACY_EVALUATOR_MAPPING_OPTIONS[value]!,
      ])
    ),
    expansions: [],
  };
};
