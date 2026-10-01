import { mappingStateSchema, type MappingState } from "./trace-mapping.ts";

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
 * The mappings an evaluator runs with when none were saved. A judge that
 * reads the whole trace gets the AI-readable trace, or the thread's steps
 * view, as its input: tool calls and results included.
 * @see specs/evaluators/judges-read-tool-evidence.feature
 */
export function defaultEvaluatorMappings({
  level,
  readsWholeTrace,
}: {
  level: "trace" | "thread";
  readsWholeTrace: boolean;
}): MappingState {
  if (level === "thread") {
    return {
      mapping: {
        input: { type: "thread", source: readsWholeTrace ? "formatted_traces" : "traces" },
      },
      expansions: [],
    };
  }
  if (!readsWholeTrace) return DEFAULT_MAPPINGS;
  return {
    mapping: { ...DEFAULT_MAPPINGS.mapping, input: { source: "formatted_trace" } },
    expansions: [],
  };
}

/** Whether a saved mapping maps anything: `{}` is what a create with no mappings stores. */
export const hasMappingEntries = (mappings: MappingState | null): mappings is MappingState =>
  mappings !== null && Object.keys(mappings.mapping).length > 0;

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
  const current = mappings.mapping ? mappingStateSchema.safeParse(mappings) : undefined;
  if (current?.success) return current.data;

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
