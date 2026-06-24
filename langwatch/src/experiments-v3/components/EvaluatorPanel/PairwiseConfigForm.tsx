import {
  Box,
  Checkbox,
  Field,
  HStack,
  Icon,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ChangeEvent } from "react";
import { LuCheck } from "react-icons/lu";

import type {
  PairwiseEvaluatorConfig,
  TargetConfig,
} from "../../types";

/**
 * Configuration form for the langevals/pairwise_compare evaluator
 * (#5100). Three required selects:
 *
 *   1. Variant A   — id of an existing TargetConfig
 *   2. Variant B   — id of a different existing TargetConfig
 *   3. Golden      — name of a dataset column whose value is the
 *                    reference answer
 *
 * Plus optional metrics checkboxes (cost / latency) that inject
 * per-candidate stats into the judge prompt.
 *
 * Rendered inside `ConfigPanel` when the user adds an evaluator of
 * type `langevals/pairwise_compare`.
 */

export type DatasetColumn = { id: string; name: string };

export type PairwiseConfigFormProps = {
  value: PairwiseEvaluatorConfig;
  onChange: (next: PairwiseEvaluatorConfig) => void;
  /** All targets the user has configured (excluding evaluator-as-target). */
  targets: TargetConfig[];
  /** Active dataset columns the user can pick the golden field from. */
  datasetColumns: DatasetColumn[];
};

export function PairwiseConfigForm({
  value,
  onChange,
  targets,
  datasetColumns,
}: PairwiseConfigFormProps) {
  const update = (patch: Partial<PairwiseEvaluatorConfig>) => {
    onChange({ ...value, ...patch });
  };

  const toggleMetric = (metric: "cost" | "duration", on: boolean) => {
    const set = new Set(value.includeMetrics);
    if (on) set.add(metric);
    else set.delete(metric);
    update({ includeMetrics: Array.from(set) });
  };

  // Variant B options exclude variant A so the user can't pick the same
  // target twice (a pairwise comparison of X vs X is always a tie).
  const variantBOptions = targets.filter((t) => t.id !== value.variantA);

  return (
    <VStack align="stretch" gap={4} padding={4}>
      <Field.Root required>
        <Field.Label>Variant A</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={value.variantA}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => update({ variantA: e.currentTarget.value })}
          >
            <option value="">Select a target…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
          </NativeSelect.Field>
        </NativeSelect.Root>
      </Field.Root>

      <Field.Root required>
        <Field.Label>Variant B</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={value.variantB}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => update({ variantB: e.currentTarget.value })}
          >
            <option value="">Select a target…</option>
            {variantBOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
          </NativeSelect.Field>
        </NativeSelect.Root>
      </Field.Root>

      <Field.Root required>
        <Field.Label>Golden field</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={value.goldenField}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => update({ goldenField: e.currentTarget.value })}
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
            checked={value.includeMetrics.includes("cost")}
            onCheckedChange={(d) => toggleMetric("cost", d.checked === true)}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>Include cost</Checkbox.Label>
          </Checkbox.Root>
          <Checkbox.Root
            checked={value.includeMetrics.includes("duration")}
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

      <HStack gap={2} color="fg.muted" fontSize="xs">
        <Icon as={LuCheck} color="green.fg" boxSize="14px" />
        <Text>Bias-corrected (2× judge calls)</Text>
      </HStack>
    </VStack>
  );
}
