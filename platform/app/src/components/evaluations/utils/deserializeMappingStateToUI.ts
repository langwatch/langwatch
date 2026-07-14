/**
 * Deserialize a persisted MappingState back to UI field mappings.
 *
 * The `monitorLevel` determines the default sourceId. Thread-typed mappings
 * always get sourceId "thread", even when the monitor level is "trace"
 * (mixed trace + thread scenario).
 */
import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import type { MappingState } from "~/server/tracer/tracesMapping";

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
