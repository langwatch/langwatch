import {
  Box,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import type { TargetConfig } from "../../types";

/**
 * Per-candidate source picker for cross-experiment pairwise (#5102).
 *
 * Renders inline inside a candidate row:
 *
 *   [ Target ▾ ] [ From ▾ This experiment / baseline-v1.1 / … ] ✕
 *
 * When `From` is set to another experiment, the Target select switches
 * to that experiment's target list (extracted from its workbenchState).
 *
 * Filtering:
 *   - The picker only lists experiments the user can access (the tRPC
 *     query already enforces `experiments:view` on the project).
 *   - Experiments with a different `datasetId` than the current
 *     workbench are listed but shown with a mismatch hint and disabled
 *     for selection — keeps the "Picker rejects an experiment with a
 *     different dataset" scenario honest.
 *   - The current experiment (if `currentExperimentId` is passed) is
 *     filtered out — "From: this experiment" is the dedicated default.
 */

export type CrossExperimentPickerValue = {
  targetId: string;
  /** undefined = this experiment; otherwise the chosen experiment id. */
  fromExperimentId?: string;
};

export type CrossExperimentPickerProps = {
  value: CrossExperimentPickerValue;
  onChange: (next: CrossExperimentPickerValue) => void;
  onRemove?: () => void;
  /** Local targets for the "This experiment" case. */
  localTargets: TargetConfig[];
  /** Active workbench's datasetId — secondary experiments must match. */
  currentDatasetId: string | null;
  /** Currently-edited experiment id to filter OUT of the "from" list. */
  currentExperimentId?: string;
};

type ExperimentSummary = {
  id: string;
  name: string;
  slug: string;
  datasetId: string | null;
  targets: TargetConfig[];
};

/** Extract datasetId + targets from a persisted workbenchState blob. */
function extractWorkbenchMeta(
  workbenchState: unknown,
): { datasetId: string | null; targets: TargetConfig[] } {
  if (!workbenchState || typeof workbenchState !== "object") {
    return { datasetId: null, targets: [] };
  }
  const wb = workbenchState as {
    datasets?: Array<{ datasetId?: string; id?: string }>;
    targets?: TargetConfig[];
  };
  const datasetId =
    wb.datasets?.[0]?.datasetId ?? wb.datasets?.[0]?.id ?? null;
  const targets = Array.isArray(wb.targets) ? wb.targets : [];
  return { datasetId, targets };
}

export function CrossExperimentPicker({
  value,
  onChange,
  onRemove,
  localTargets,
  currentDatasetId,
  currentExperimentId,
}: CrossExperimentPickerProps) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  // Lazy: only fetch when the user opens the source dropdown the first time.
  const [hasOpened, setHasOpened] = useState(false);
  const experimentsQuery = api.experiments.getAllByProjectId.useQuery(
    { projectId },
    { enabled: !!projectId && hasOpened, staleTime: 30_000 },
  );

  const allExperiments: ExperimentSummary[] = useMemo(() => {
    const data = experimentsQuery.data ?? [];
    return data
      .filter((e) => e.id !== currentExperimentId)
      .filter((e) => !e.archivedAt)
      .map((e) => {
        const meta = extractWorkbenchMeta(e.workbenchState);
        return {
          id: e.id,
          name: e.name ?? e.slug,
          slug: e.slug,
          datasetId: meta.datasetId,
          targets: meta.targets,
        };
      });
  }, [experimentsQuery.data, currentExperimentId]);

  const selectedExperiment = value.fromExperimentId
    ? allExperiments.find((e) => e.id === value.fromExperimentId)
    : undefined;
  const datasetMismatch = !!(
    selectedExperiment &&
    currentDatasetId &&
    selectedExperiment.datasetId &&
    selectedExperiment.datasetId !== currentDatasetId
  );

  // Targets to choose from: local for "this experiment", secondary's
  // targets when an experiment is selected and its workbenchState
  // surfaced any.
  const availableTargets = selectedExperiment
    ? selectedExperiment.targets
    : localTargets;

  const onSourceChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.currentTarget.value;
    if (next === "__this__") {
      onChange({ targetId: value.targetId, fromExperimentId: undefined });
    } else {
      onChange({ targetId: "", fromExperimentId: next });
    }
  };

  return (
    <HStack gap={2} align="flex-start" width="full">
      <Field.Root flex={1}>
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value={value.targetId}
            onChange={(e) =>
              onChange({ ...value, targetId: e.currentTarget.value })
            }
            disabled={datasetMismatch}
            aria-label="Target"
          >
            <option value="">Select target…</option>
            {availableTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
            {/* If the saved targetId isn't in the available list, keep it visible
                so the user can see what's stored and re-pick rather than have
                it silently disappear. */}
            {value.targetId &&
            !availableTargets.find((t) => t.id === value.targetId) ? (
              <option value={value.targetId}>{value.targetId} (missing)</option>
            ) : null}
          </NativeSelect.Field>
        </NativeSelect.Root>
      </Field.Root>

      <Field.Root flex={1.2}>
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value={value.fromExperimentId ?? "__this__"}
            onChange={onSourceChange}
            onFocus={() => setHasOpened(true)}
            aria-label="From experiment"
          >
            <option value="__this__">This experiment</option>
            {experimentsQuery.isLoading ? (
              <option disabled>Loading…</option>
            ) : null}
            {allExperiments.map((e) => {
              const mismatch = !!(
                currentDatasetId &&
                e.datasetId &&
                e.datasetId !== currentDatasetId
              );
              return (
                <option key={e.id} value={e.id} disabled={mismatch}>
                  {e.name}
                  {mismatch ? " (different dataset)" : ""}
                </option>
              );
            })}
          </NativeSelect.Field>
        </NativeSelect.Root>
      </Field.Root>

      {onRemove ? (
        <Box
          as="button"
          type="button"
          aria-label="Remove candidate"
          onClick={onRemove}
          paddingX={2}
          paddingY={1}
          color="fg.muted"
          _hover={{ color: "red.fg" }}
          fontSize="sm"
        >
          ✕
        </Box>
      ) : null}

      {datasetMismatch ? (
        <Text fontSize="xs" color="red.fg" position="absolute" marginTop={10}>
          Different dataset.{" "}
          {selectedExperiment?.name ?? "baseline"} uses{" "}
          {selectedExperiment?.datasetId ?? "?"}; this experiment uses{" "}
          {currentDatasetId ?? "?"}.
        </Text>
      ) : null}
    </HStack>
  );
}
