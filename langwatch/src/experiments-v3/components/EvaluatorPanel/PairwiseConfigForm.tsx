import {
  Box,
  Field,
  HStack,
  Icon,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ChangeEvent } from "react";
import { useCallback } from "react";
import {
  type UseFormReturn,
  useForm,
  useFormContext,
  useWatch,
} from "react-hook-form";
import { LuCheck } from "react-icons/lu";

import { Switch } from "~/components/ui/switch";

import type {
  PairwiseEvaluatorConfig,
  TargetConfig,
} from "../../types";

/**
 * Configuration form for the langevals/pairwise_compare evaluator
 * (#5100). Required selects:
 *
 *   1. Variant A   — id of an existing TargetConfig
 *   2. Variant B   — id of a different existing TargetConfig
 *   3. Golden      — name of a dataset column whose value is the
 *                    reference answer
 *
 * Plus per-candidate metric switches (cost / duration). The metric
 * switches read/write directly to the parent form's
 * `settings.include_metrics` so there's a single source of truth
 * that the runner actually consumes — the legacy
 * `pairwise.includeMetrics` is mirrored on every write so existing
 * orchestrator paths keep working until they're migrated.
 *
 * Rendered inside `EvaluatorEditorBody` when the user edits an
 * evaluator of type `langevals/pairwise_compare`.
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

type Metric = "cost" | "duration";

export function PairwiseConfigForm({
  value,
  onChange,
  targets,
  datasetColumns,
}: PairwiseConfigFormProps) {
  // useFormContext returns null when this form is rendered bare (the
  // visual-preview tests do that). Maintain a local fallback form so the
  // toggles stay interactive in that mode — useWatch needs a real control.
  const parentForm = useFormContext<{
    name: string;
    settings: { include_metrics?: Metric[] };
  }>() as
    | UseFormReturn<{ name: string; settings: { include_metrics?: Metric[] } }>
    | null;
  const fallbackForm = useForm<{
    name: string;
    settings: { include_metrics?: Metric[] };
  }>({
    defaultValues: {
      name: "",
      settings: { include_metrics: value.includeMetrics ?? [] },
    },
  });
  const form = parentForm ?? fallbackForm;

  const formMetrics = useWatch({
    control: form.control,
    name: "settings.include_metrics",
  }) as Metric[] | undefined;

  // Single source of truth: prefer the parent form, fall back to the
  // legacy pairwise.includeMetrics record for back-compat reads.
  const activeMetrics: Metric[] = formMetrics ?? value.includeMetrics ?? [];

  const update = (patch: Partial<PairwiseEvaluatorConfig>) => {
    onChange({ ...value, ...patch });
  };

  const toggleMetric = useCallback(
    (metric: Metric, on: boolean) => {
      const set = new Set(activeMetrics);
      if (on) set.add(metric);
      else set.delete(metric);
      const next = Array.from(set);
      form.setValue("settings.include_metrics", next, {
        shouldDirty: true,
        shouldTouch: true,
      });
      // Keep the legacy pairwise mirror in sync until callers stop reading it.
      update({ includeMetrics: next });
    },
    [activeMetrics, form, value, onChange],
  );

  // Variant B options exclude variant A so the user can't pick the same
  // target twice (a pairwise comparison of X vs X is always a tie).
  const variantBOptions = targets.filter((t) => t.id !== value.variantA);

  return (
    <VStack align="stretch" gap={4} padding={4}>
      <Box>
        <Text fontSize="sm" fontWeight="medium">
          Include Metrics
        </Text>
        <Text fontSize="xs" color="fg.muted" marginBottom={2}>
          Per-candidate metrics to inject into the judge prompt
        </Text>
        <VStack align="stretch" gap={2}>
          <Switch
            checked={activeMetrics.includes("cost")}
            onCheckedChange={(d) => toggleMetric("cost", d.checked === true)}
            data-testid="pairwise-include-cost"
          >
            Include cost
          </Switch>
          <Switch
            checked={activeMetrics.includes("duration")}
            onCheckedChange={(d) =>
              toggleMetric("duration", d.checked === true)
            }
            data-testid="pairwise-include-duration"
          >
            Include duration
          </Switch>
        </VStack>
      </Box>

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

      <HStack gap={2} color="fg.muted" fontSize="xs">
        <Icon as={LuCheck} color="green.fg" boxSize="14px" />
        <Text>Bias-corrected (2× judge calls)</Text>
      </HStack>
    </VStack>
  );
}
