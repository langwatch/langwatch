/**
 * Serialize UI field mappings to the MappingState format persisted on monitors.
 *
 * Thread sources (sources found in THREAD_MAPPINGS, SERVER_ONLY_THREAD_SOURCES,
 * or with sourceId "thread") are marked with `type: "thread"`.
 */
import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import {
  type MappingState,
  SERVER_ONLY_THREAD_SOURCES,
  THREAD_MAPPINGS,
  TRACE_MAPPINGS,
} from "~/server/tracer/tracesMapping";

export function serializeMappingsToMappingState(
  mappings: Record<string, UIFieldMapping>,
): MappingState {
  const mappingState: MappingState = {
    mapping: {},
    expansions: [],
  };

  for (const [field, mapping] of Object.entries(mappings)) {
    if (mapping.type === "source" && mapping.path.length > 0) {
      const parts = mapping.path;
      const source = parts[0]!;

      const isThreadSource =
        source in THREAD_MAPPINGS ||
        (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source) ||
        mapping.sourceId === "thread";

      if (isThreadSource) {
        const selectedFields =
          parts.length > 1 ? parts.slice(1) : undefined;
        mappingState.mapping[field] = {
          type: "thread" as const,
          source: source as
            | keyof typeof THREAD_MAPPINGS
            | (typeof SERVER_ONLY_THREAD_SOURCES)[number],
          selectedFields,
        };
      } else {
        mappingState.mapping[field] = {
          source: source as keyof typeof TRACE_MAPPINGS,
          key: parts[1],
          subkey: parts[2],
        };
      }
    }
  }

  return mappingState;
}
