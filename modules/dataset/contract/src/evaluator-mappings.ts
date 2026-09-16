import type { MappingState } from "./trace-mapping.ts";

export const DEFAULT_MAPPINGS: MappingState = {
  mapping: {
    spans: {
      source: "spans",
    },
    input: {
      source: "input",
    },
    output: {
      source: "output",
    },
    contexts: {
      source: "contexts",
    },
    expected_output: {
      source: "metadata",
      key: "expected_output",
    },
  },
  expansions: [],
};

/**
 * Whether any mapping entry reads the `evaluations` source, gating the
 * prior-evaluations enrichment fetch (a heavy ClickHouse read) on need.
 * Legacy (pre-migration) mappings can't reference it, so this is false.
 */
export const mappingsReadEvaluationsSource = (mappings: MappingState | null): boolean =>
  Object.values(mappings?.mapping ?? {}).some(
    (config) => "source" in config && config.source === "evaluations",
  );

export const migrateLegacyMappings = (mappings: Record<string, string>): MappingState => {
  if (mappings.mapping) {
    return mappings as any as MappingState;
  }

  const LEGACY_EVALUATOR_MAPPING_OPTIONS: Record<string, MappingState["mapping"][number]> = {
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
      ]),
    ),
    expansions: [],
  };
};
