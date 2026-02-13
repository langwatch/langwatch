import { Box, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AvailableSource,
  type FieldMapping as UIFieldMapping,
  VariablesSection,
} from "~/components/variables";
import { validateEvaluatorMappingsWithFields } from "~/evaluations-v3/utils/mappingValidation";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectSpanNames } from "~/hooks/useProjectSpanNames";
import {
  getTraceAvailableSources,
  getThreadAvailableSources,
} from "~/server/tracer/tracesMapping";

export type EvaluatorMappingsSectionProps = {
  evaluatorDef:
    | {
        requiredFields?: string[];
        optionalFields?: string[];
      }
    | undefined;
  /**
   * For online evaluation: specify level and sources will be fetched automatically.
   */
  level?: "trace" | "thread";
  /**
   * For dataset evaluation: provide sources directly.
   * If provided, takes precedence over level-based fetching.
   */
  providedSources?: AvailableSource[];
  /** Initial mappings - used to seed local state */
  initialMappings: Record<string, UIFieldMapping>;
  /** Callback to persist changes to store */
  onMappingChange: (
    identifier: string,
    mapping: UIFieldMapping | undefined,
  ) => void;
  /** Whether to scroll to the first missing mapping on mount */
  scrollToMissingOnMount?: boolean;
};

/**
 * Sub-component for evaluator input mappings.
 * Manages local state for immediate UI feedback, persists via onMappingChange.
 * Computes missingMappingIds reactively from local state.
 *
 * Supports two modes:
 * 1. Level-based: fetches span names/metadata keys internally (avoids race conditions)
 * 2. Provided sources: uses the sources passed directly (for dataset evaluations)
 */
export function EvaluatorMappingsSection({
  evaluatorDef,
  level,
  providedSources,
  initialMappings,
  onMappingChange,
  scrollToMissingOnMount = false,
}: EvaluatorMappingsSectionProps) {
  const { project } = useOrganizationTeamProject();

  // Fetch span names and metadata keys for level-based mode
  // Only used when providedSources is not given
  const { spanNames, metadataKeys } = useProjectSpanNames(
    providedSources ? undefined : project?.id
  );

  // Build availableSources - use providedSources if given, otherwise fetch based on level
  const availableSources = useMemo(() => {
    // If sources are provided directly, use them (dataset evaluation mode)
    if (providedSources) {
      return providedSources;
    }
    // Otherwise, fetch based on level (online evaluation mode)
    if (level === "thread") {
      return getThreadAvailableSources() as AvailableSource[];
    }
    return getTraceAvailableSources(spanNames, metadataKeys) as AvailableSource[];
  }, [providedSources, level, spanNames, metadataKeys]);

  // Local state for mappings - source of truth for UI
  const [localMappings, setLocalMappings] =
    useState<Record<string, UIFieldMapping>>(initialMappings);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Sync from props when they change (e.g., dataset switch causing drawer to get new props)
  useEffect(() => {
    setLocalMappings(initialMappings);
  }, [initialMappings]);

  // Compute missingMappingIds REACTIVELY from local state using shared validation
  const missingMappingIds = useMemo(() => {
    const requiredFields = evaluatorDef?.requiredFields ?? [];
    const optionalFields = evaluatorDef?.optionalFields ?? [];
    const allFields = [...requiredFields, ...optionalFields];

    // Use the same shared validation logic as OnlineEvaluationDrawer
    const validation = validateEvaluatorMappingsWithFields(
      requiredFields,
      optionalFields,
      localMappings,
    );

    const missing = new Set<string>(validation.missingRequiredFields);

    // Special case: if ALL fields are empty and there are no required fields,
    // highlight the first field to indicate something is needed
    if (
      !validation.hasAnyMapping &&
      validation.missingRequiredFields.length === 0 &&
      allFields.length > 0
    ) {
      missing.add(allFields[0]!);
    }

    return missing;
  }, [evaluatorDef, localMappings]);

  // Scroll to first missing mapping on mount
  useEffect(() => {
    if (
      scrollToMissingOnMount &&
      !hasScrolledRef.current &&
      missingMappingIds.size > 0 &&
      containerRef.current
    ) {
      // Small delay to ensure DOM is rendered
      const timer = setTimeout(() => {
        const firstMissingId = Array.from(missingMappingIds)[0];
        const missingElement = containerRef.current?.querySelector(
          `[data-testid="missing-mapping-input"], [data-variable-id="${firstMissingId}"]`,
        );
        if (missingElement) {
          missingElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } else {
          // Fallback: scroll to the container itself (mappings section)
          containerRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
        hasScrolledRef.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [scrollToMissingOnMount, missingMappingIds]);

  // Handler that updates local state AND persists to store
  const handleMappingChange = useCallback(
    (identifier: string, mapping: UIFieldMapping | undefined) => {
      // Update local state immediately for responsive UI
      setLocalMappings((prev) => {
        const next = { ...prev };
        if (mapping) {
          next[identifier] = mapping;
        } else {
          delete next[identifier];
        }
        return next;
      });

      // Persist to store
      onMappingChange(identifier, mapping);
    },
    [onMappingChange],
  );

  // Build variables from evaluator definition's required/optional fields
  const variables = useMemo(() => {
    const allFields = [
      ...(evaluatorDef?.requiredFields ?? []),
      ...(evaluatorDef?.optionalFields ?? []),
    ];
    return allFields.map((field) => ({
      identifier: field,
      type: "str" as const,
    }));
  }, [evaluatorDef]);

  if (variables.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        This evaluator does not require any input mappings.
      </Text>
    );
  }

  return (
    <Box ref={containerRef}>
      <VariablesSection
        title="Variables"
        variables={variables}
        // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op - evaluator inputs are read-only
        onChange={() => {}}
        showMappings={true}
        availableSources={availableSources}
        mappings={localMappings}
        onMappingChange={handleMappingChange}
        readOnly={true} // Can't add/remove evaluator inputs
        missingMappingIds={missingMappingIds}
      />
    </Box>
  );
}
