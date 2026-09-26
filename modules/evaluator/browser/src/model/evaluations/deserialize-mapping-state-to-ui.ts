import type { MappingState } from "@langwatch/dataset-contract";
/**
 * Deserializes a persisted MappingState to UI field mappings.
 * `monitorLevel` sets the default sourceId; thread-typed mappings
 * always get sourceId "thread", even for a "trace"-level monitor.
 */
import type { FieldMapping as UIFieldMapping } from "@langwatch/prompt-browser-kit";

export function deserializeMappingStateToUI(
  existingMappings: MappingState,
  monitorLevel: "trace" | "thread",
): Record<string, UIFieldMapping> {
  const uiMappings: Record<string, UIFieldMapping> = {};

  for (const [field, mapping] of Object.entries(existingMappings.mapping)) {
    if (!mapping.source) continue;
    const isThreadMapping = "type" in mapping && mapping.type === "thread";
    uiMappings[field] = {
      type: "source",
      sourceId: monitorLevel === "thread" || isThreadMapping ? "thread" : "trace",
      path: [mapping.source as string, ...mappingPathTail(mapping)],
    };
  }

  return uiMappings;
}

type PersistedFieldMapping = MappingState["mapping"][string];

function mappingPathTail(mapping: PersistedFieldMapping): string[] {
  if ("type" in mapping && mapping.type === "thread") {
    return "selectedFields" in mapping && mapping.selectedFields?.length
      ? [...mapping.selectedFields]
      : [];
  }
  const tail: string[] = [];
  if ("key" in mapping && mapping.key) tail.push(mapping.key);
  if ("subkey" in mapping && mapping.subkey) tail.push(mapping.subkey);
  return tail;
}
