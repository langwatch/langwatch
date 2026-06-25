import {
  Box,
  Button,
  Checkbox,
  Field,
  HStack,
  Icon,
  NativeSelect,
  RadioGroup,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ChangeEvent } from "react";
import { LuCheck, LuInfo, LuPlus } from "react-icons/lu";

import type {
  PairwiseCandidate,
  PairwiseEvaluatorConfig,
  TargetConfig,
} from "../../types";
import { normalizePairwiseConfig } from "../../types";

import { CrossExperimentPicker } from "./CrossExperimentPicker";

/**
 * Configuration form for the langevals/pairwise_compare evaluator.
 *
 * Three feature waves, all driven by the same `candidates[]` schema
 * (#5102) — `normalizePairwiseConfig` hydrates the legacy `variants[]`
 * (#5101) and `variantA`/`variantB` (#5100) shapes into `candidates[]`
 * so saved configs from any era keep working without migration.
 *
 *   - mode == "pairwise"    — exactly 2 candidates, swap-and-confirm
 *   - mode == "select_best" — N ≥ 2 candidates, randomize_order
 *   - any candidate may set `fromExperimentId` to pull its output from
 *     a SECONDARY experiment (cross-experiment comparison, #5102)
 *
 * Form ALWAYS writes the canonical `{ candidates, mode }` shape and
 * clears the deprecated `variantA`/`variantB`/`variants` fields on
 * every write — the schema still keeps `variants` as a derived view
 * for back-compat readers, but the form is the source of truth here.
 */

export type DatasetColumn = { id: string; name: string };

export type PairwiseConfigFormProps = {
  value: PairwiseEvaluatorConfig;
  onChange: (next: PairwiseEvaluatorConfig) => void;
  /** All targets in the CURRENT workbench (excluding evaluator-as-target). */
  targets: TargetConfig[];
  /** Active dataset columns the user can pick the golden field from. */
  datasetColumns: DatasetColumn[];
  /** Active dataset id — feeds the CrossExperimentPicker's match check. */
  currentDatasetId?: string | null;
  /** Currently-edited experiment id — filtered out of the "From" picker. */
  currentExperimentId?: string;
};

export function PairwiseConfigForm({
  value,
  onChange,
  targets,
  datasetColumns,
  currentDatasetId = null,
  currentExperimentId,
}: PairwiseConfigFormProps) {
  const cfg = normalizePairwiseConfig(value);
  const candidates = cfg.candidates;
  const mode = cfg.mode;

  const update = (patch: Partial<PairwiseEvaluatorConfig>) => {
    onChange({
      ...cfg,
      variantA: undefined,
      variantB: undefined,
      variants: undefined as unknown as string[],
      ...patch,
    });
  };

  const setCandidates = (next: PairwiseCandidate[]) => {
    update({ candidates: next });
  };

  const setMode = (next: "pairwise" | "select_best") => {
    if (next === mode) return;
    update({
      mode: next,
      candidates: next === "pairwise" ? candidates.slice(0, 2) : candidates,
    });
  };

  const updateCandidateAt = (i: number, patch: Partial<PairwiseCandidate>) => {
    const next = candidates.slice();
    next[i] = { ...next[i]!, ...patch };
    setCandidates(next);
  };

  const removeCandidateAt = (i: number) => {
    setCandidates(candidates.filter((_, idx) => idx !== i));
  };

  const addCandidate = () => {
    if (mode === "pairwise" && candidates.length >= 2) return;
    setCandidates([...candidates, { targetId: "" }]);
  };

  const toggleMetric = (metric: "cost" | "duration", on: boolean) => {
    const set = new Set(cfg.includeMetrics);
    if (on) set.add(metric);
    else set.delete(metric);
    update({ includeMetrics: Array.from(set) });
  };

  // Ensure at least 2 rows visible in pairwise mode so the user can fill
  // both slots even when the saved config is empty (e.g. brand-new
  // evaluator). The empty rows aren't persisted until the user picks
  // something — the next save round-trips through this code.
  const displayedCandidates = (() => {
    if (mode === "pairwise" && candidates.length < 2) {
      const out = candidates.slice();
      while (out.length < 2) out.push({ targetId: "" });
      return out;
    }
    return candidates;
  })();

  const minCandidates = mode === "pairwise" ? 2 : 2;
  const filledCount = candidates.filter((c) => c.targetId).length;
  const valid = filledCount >= minCandidates;

  return (
    <VStack align="stretch" gap={4} padding={4}>
      <Field.Root>
        <Field.Label>Mode</Field.Label>
        <RadioGroup.Root
          value={mode}
          onValueChange={(d) =>
            setMode((d.value as "pairwise" | "select_best") ?? "pairwise")
          }
        >
          <HStack gap={6}>
            <RadioGroup.Item value="pairwise">
              <RadioGroup.ItemHiddenInput />
              <RadioGroup.ItemIndicator />
              <RadioGroup.ItemText>A vs B</RadioGroup.ItemText>
            </RadioGroup.Item>
            <RadioGroup.Item value="select_best">
              <RadioGroup.ItemHiddenInput />
              <RadioGroup.ItemIndicator />
              <RadioGroup.ItemText>Pick best of N</RadioGroup.ItemText>
            </RadioGroup.Item>
          </HStack>
        </RadioGroup.Root>
      </Field.Root>

      <Field.Root required invalid={!valid}>
        <Field.Label>Candidates</Field.Label>
        <VStack align="stretch" gap={2}>
          {displayedCandidates.map((c, i) => (
            <CrossExperimentPicker
              key={i}
              value={c}
              onChange={(next) => {
                // If we were rendering a "ghost" empty row (i >=
                // candidates.length), promote it into the persisted list.
                if (i >= candidates.length) {
                  setCandidates([...candidates, next]);
                } else {
                  updateCandidateAt(i, next);
                }
              }}
              onRemove={
                displayedCandidates.length > minCandidates &&
                i < candidates.length
                  ? () => removeCandidateAt(i)
                  : undefined
              }
              localTargets={targets}
              currentDatasetId={currentDatasetId}
              currentExperimentId={currentExperimentId}
            />
          ))}
        </VStack>

        {mode === "select_best" ? (
          <Button
            size="xs"
            variant="ghost"
            alignSelf="flex-start"
            marginTop={2}
            onClick={addCandidate}
          >
            <Icon as={LuPlus} boxSize="14px" />
            Add candidate
          </Button>
        ) : null}

        {!valid ? (
          <Field.ErrorText>
            {mode === "pairwise"
              ? "Pick a target for both A and B."
              : "Select at least 2 candidates."}
          </Field.ErrorText>
        ) : (
          <Field.HelperText>
            {filledCount} candidate{filledCount === 1 ? "" : "s"} selected ·{" "}
            {mode === "pairwise"
              ? "2 judge calls per row (swap-and-confirm)"
              : "1 judge call per row"}
          </Field.HelperText>
        )}
      </Field.Root>

      <Field.Root required>
        <Field.Label>Golden field</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={cfg.goldenField}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              update({ goldenField: e.currentTarget.value })
            }
          >
            <option value="">Select a dataset column…</option>
            {datasetColumns.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </NativeSelect.Field>
        </NativeSelect.Root>
        <Field.HelperText>
          Reference answer the judge compares each candidate against.
        </Field.HelperText>
      </Field.Root>

      <Box>
        <Text fontSize="sm" fontWeight="medium" marginBottom={2}>
          Include metrics in prompt
        </Text>
        <VStack align="stretch" gap={1}>
          <Checkbox.Root
            checked={cfg.includeMetrics.includes("cost")}
            onCheckedChange={(d) => toggleMetric("cost", d.checked === true)}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>Include cost</Checkbox.Label>
          </Checkbox.Root>
          <Checkbox.Root
            checked={cfg.includeMetrics.includes("duration")}
            onCheckedChange={(d) =>
              toggleMetric("duration", d.checked === true)
            }
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>Include latency</Checkbox.Label>
          </Checkbox.Root>
        </VStack>
      </Box>

      {mode === "pairwise" ? (
        <HStack gap={2} color="fg.muted" fontSize="xs">
          <Icon as={LuCheck} color="green.fg" boxSize="14px" />
          <Text>Bias-corrected (2× judge calls)</Text>
        </HStack>
      ) : (
        <HStack gap={2} color="fg.muted" fontSize="xs">
          <Icon as={LuInfo} boxSize="14px" />
          <Text>
            Order-randomized (1 judge call/row, candidates shuffled per row
            index for position-bias mitigation)
          </Text>
        </HStack>
      )}
    </VStack>
  );
}
