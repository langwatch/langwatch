import {
  Box,
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
import { LuCheck, LuInfo } from "react-icons/lu";

import type {
  PairwiseEvaluatorConfig,
  TargetConfig,
} from "../../types";
import { normalizePairwiseConfig } from "../../types";

/**
 * Configuration form for the langevals/pairwise_compare evaluator.
 * Two modes (#5101 extends the #5100 MVP):
 *
 *   - "pairwise"    — exactly 2 candidates, swap-and-confirm
 *   - "select_best" — N ≥ 2 candidates, randomize_order
 *
 * The form ALWAYS writes the canonical `variants` array + `mode`
 * fields. Legacy `variantA` / `variantB` are read for back-compat
 * (via normalizePairwiseConfig) but never re-written, so the rest
 * of the codebase can migrate to the canonical shape.
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
  // Always read through the normalizer so legacy variantA / variantB
  // records show up correctly in the form on first load. The form
  // emits the canonical shape going forward.
  const cfg = normalizePairwiseConfig(value);
  const variants = cfg.variants;
  const mode = cfg.mode;

  const update = (patch: Partial<PairwiseEvaluatorConfig>) => {
    onChange({
      ...cfg,
      // Clear the deprecated 2-way fields on every write so we don't
      // leave them drifting out of sync with `variants`.
      variantA: undefined,
      variantB: undefined,
      ...patch,
    });
  };

  const setMode = (next: "pairwise" | "select_best") => {
    if (next === mode) return;
    // Switching INTO pairwise mode keeps only the first two variants;
    // switching INTO select_best mode just changes the mode flag.
    update({
      mode: next,
      variants: next === "pairwise" ? variants.slice(0, 2) : variants,
    });
  };

  const setVariantAt = (slot: 0 | 1, id: string) => {
    // Pairwise mode keeps the legacy two-slot UX; we mirror the user's
    // selections back into a 2-element variants array.
    const next = [...variants];
    while (next.length <= slot) next.push("");
    next[slot] = id;
    update({ variants: next.slice(0, 2) });
  };

  const toggleVariant = (id: string, on: boolean) => {
    const set = new Set(variants);
    if (on) set.add(id);
    else set.delete(id);
    update({ variants: Array.from(set) });
  };

  const toggleMetric = (metric: "cost" | "duration", on: boolean) => {
    const set = new Set(cfg.includeMetrics);
    if (on) set.add(metric);
    else set.delete(metric);
    update({ includeMetrics: Array.from(set) });
  };

  const variantA = variants[0] ?? "";
  const variantB = variants[1] ?? "";
  const variantBOptions = targets.filter((t) => t.id !== variantA);

  const selectBestValid = mode !== "select_best" || variants.length >= 2;

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

      {mode === "pairwise" ? (
        <>
          <Field.Root required>
            <Field.Label>Variant A</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={variantA}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setVariantAt(0, e.currentTarget.value)
                }
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
                value={variantB}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setVariantAt(1, e.currentTarget.value)
                }
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
        </>
      ) : (
        <Field.Root required invalid={!selectBestValid}>
          <Field.Label>Variants</Field.Label>
          <VStack align="stretch" gap={1}>
            {targets.map((t) => (
              <Checkbox.Root
                key={t.id}
                checked={variants.includes(t.id)}
                onCheckedChange={(d) =>
                  toggleVariant(t.id, d.checked === true)
                }
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label>{t.id}</Checkbox.Label>
              </Checkbox.Root>
            ))}
          </VStack>
          {!selectBestValid ? (
            <Field.ErrorText>Select at least 2 variants.</Field.ErrorText>
          ) : (
            <Field.HelperText>
              {variants.length} variant{variants.length === 1 ? "" : "s"}{" "}
              selected · 1 judge call per row
            </Field.HelperText>
          )}
        </Field.Root>
      )}

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
