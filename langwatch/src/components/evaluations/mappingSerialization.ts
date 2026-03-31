/**
 * Shared serialization/deserialization functions for evaluation field mappings.
 *
 * These functions convert between the UI representation (UIFieldMapping)
 * and the persisted format (MappingState) used by monitors.
 */
import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import {
  type MappingState,
  SERVER_ONLY_THREAD_SOURCES,
  THREAD_MAPPINGS,
  TRACE_MAPPINGS,
} from "~/server/tracer/tracesMapping";

/**
 * Serialize UI field mappings to the MappingState format persisted on monitors.
 *
 * Thread sources (sources found in THREAD_MAPPINGS, SERVER_ONLY_THREAD_SOURCES,
 * or with sourceId "thread") are marked with `type: "thread"`.
 */
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

/**
 * Deserialize a persisted MappingState back to UI field mappings.
 *
 * The `monitorLevel` determines the default sourceId. Thread-typed mappings
 * always get sourceId "thread", even when the monitor level is "trace"
 * (mixed trace + thread scenario).
 */
export function deserializeMappingStateToUI(
  existingMappings: MappingState,
  monitorLevel: "trace" | "thread",
): Record<string, UIFieldMapping> {
  const uiMappings: Record<string, UIFieldMapping> = {};

  for (const [field, mapping] of Object.entries(existingMappings.mapping)) {
    if (mapping.source) {
      const pathParts: string[] = [mapping.source as string];
      if ("type" in mapping && mapping.type === "thread") {
        if (
          "selectedFields" in mapping &&
          mapping.selectedFields?.length
        ) {
          pathParts.push(...mapping.selectedFields);
        }
      } else {
        if ("key" in mapping && mapping.key) pathParts.push(mapping.key);
        if ("subkey" in mapping && mapping.subkey)
          pathParts.push(mapping.subkey);
      }

      const isThreadMapping =
        "type" in mapping && mapping.type === "thread";
      const sourceId =
        monitorLevel === "thread" || isThreadMapping ? "thread" : "trace";

      uiMappings[field] = {
        type: "source",
        sourceId,
        path: pathParts,
      };
    }
  }

  return uiMappings;
}
