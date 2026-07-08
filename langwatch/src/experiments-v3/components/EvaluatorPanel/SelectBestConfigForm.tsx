import {
  Box,
  Button,
  Field,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { Menu } from "~/components/ui/menu";
import { Switch } from "~/components/ui/switch";

import { useTargetName } from "../../hooks/useTargetName";
import type {
  SelectBestEvaluatorConfig,
  TargetConfig,
} from "../../types";

type Metric = "cost" | "duration";

/**
 * Configuration form for the langevals/select_best_compare evaluator
 * (#5101). Sibling of PairwiseConfigForm, kept intentionally separate
 * so the two evaluator paths (Pairwise Compare vs N-way Compare) never
 * couple in the UI layer either. Three configurable sections:
 *
 *   1. Variants   — multiselect of ≥2 TargetConfig ids whose per-row
 *                   outputs are the candidates the judge picks between
 *   2. Golden     — dataset column whose value is the reference answer
 *   3. Metrics    — cost / duration toggles mirrored into `settings.include_metrics`
 *
 * A single N-way judge call per row picks a winner; candidate order is
 * shuffled deterministically per row (seeded by rowIndex) to mitigate
 * position bias — mirrors the Python evaluator's `randomize_order`
 * setting, exposed here as a checkbox in the settings section above.
 */

export type DatasetColumn = { id: string; name: string };

export type SelectBestConfigFormProps = {
  value: SelectBestEvaluatorConfig;
  onChange: (next: SelectBestEvaluatorConfig) => void;
  /** All targets the user has configured (excluding evaluator-as-target). */
  targets: TargetConfig[];
  /** Active dataset columns the user can pick the golden field from. */
  datasetColumns: DatasetColumn[];
};

export function SelectBestConfigForm({
  value,
  onChange,
  targets,
  datasetColumns,
}: SelectBestConfigFormProps) {
  // Same local-draft + ref pattern PairwiseConfigForm uses so back-to-back
  // picks against a stale `value` prop don't stomp each other. Parent-
  // pushed value changes still resync `draft`.
  const [draft, setDraft] = useState<SelectBestEvaluatorConfig>(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const update = (patch: Partial<SelectBestEvaluatorConfig>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    onChange(next);
  };

  return (
    <VStack align="stretch" gap={3}>
      <VariantsMultiSelect
        draft={draft}
        update={update}
        targets={targets}
      />

      <GoldenFieldPicker
        draft={draft}
        update={update}
        datasetColumns={datasetColumns}
      />

      <MetricsSection draft={draft} update={update} />
    </VStack>
  );
}

/**
 * Multi-select over available targets. Requires ≥2 to be picked before
 * the evaluator can save (enforced downstream by the orchestrator's
 * `Select-best evaluator skipped: fewer than 2 variants configured`
 * guard, and mirrored client-side here via a validation message).
 */
function VariantsMultiSelect({
  draft,
  update,
  targets,
}: {
  draft: SelectBestEvaluatorConfig;
  update: (patch: Partial<SelectBestEvaluatorConfig>) => void;
  targets: TargetConfig[];
}) {
  const selected = draft.variants ?? [];
  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((v) => v !== id)
      : [...selected, id];
    update({ variants: next });
  };

  const insufficient = selected.length < 2;

  return (
    <Field.Root required flex="1">
      <Field.Label fontSize="13px" color="fg.muted" marginBottom={1}>
        Variants (pick 2 or more)
      </Field.Label>
      <Menu.Root closeOnSelect={false}>
        <Menu.Trigger asChild>
          <Button
            variant="outline"
            colorPalette="gray"
            size="sm"
            fontWeight="normal"
            justifyContent="space-between"
            width="full"
            data-testid="select-best-variants"
          >
            <Text
              fontSize="13px"
              color={selected.length === 0 ? "fg.subtle" : "fg"}
              truncate
            >
              {selected.length === 0
                ? "Select variants to compare…"
                : `${selected.length} selected`}
            </Text>
            <ChevronDown size={14} color="var(--chakra-colors-fg-muted)" />
          </Button>
        </Menu.Trigger>
        <Menu.Content portalled={true} maxHeight="240px" overflowY="auto">
          {targets.length === 0 ? (
            <Menu.Item value="__empty__" disabled>
              <Text fontSize="13px" color="fg.subtle">
                No targets available
              </Text>
            </Menu.Item>
          ) : (
            targets.map((t) => (
              <VariantMenuItem
                key={t.id}
                target={t}
                checked={selected.includes(t.id)}
                onToggle={() => toggle(t.id)}
              />
            ))
          )}
        </Menu.Content>
      </Menu.Root>
      {insufficient && (
        <Text
          fontSize="xs"
          color="orange.solid"
          marginTop={2}
          data-testid="select-best-variants-insufficient"
        >
          Pick at least 2 variants — a comparison needs candidates on both
          sides.
        </Text>
      )}
      <Text fontSize="xs" color="fg.muted" marginTop={2}>
        The judge picks the best of these variants in one call per row.
        Candidate order is shuffled deterministically per row to mitigate
        position bias.
      </Text>
    </Field.Root>
  );
}

/**
 * Individual menu item — split so `useTargetName` (which needs a stable
 * target) is called at a stable hook position even as the target list
 * grows / shrinks. Same pattern PairwiseConfigForm uses for its
 * TargetNameContributor helper.
 */
function VariantMenuItem({
  target,
  checked,
  onToggle,
}: {
  target: TargetConfig;
  checked: boolean;
  onToggle: () => void;
}) {
  const name = useTargetName(target) ?? target.id;
  return (
    <Menu.Item
      value={target.id}
      onClick={onToggle}
      data-testid={`select-best-variant-option-${target.id}`}
    >
      <HStack gap={2} width="full" justify="space-between">
        <Text fontSize="13px">{name}</Text>
        {checked && (
          <Check size={14} color="var(--chakra-colors-blue-solid)" />
        )}
      </HStack>
    </Menu.Item>
  );
}

/**
 * Golden field picker. Unlike PairwiseConfigForm this has no
 * "hasGoldenAnswer" toggle — the N-way default judge prompt is
 * golden-aware and there's no reasonable golden-free default for
 * "which is the best of N unrelated outputs" without a reference.
 * Users needing golden-free N-way comparison should customize
 * `settings.prompt` directly (kept as an escape hatch, not a chrome).
 */
function GoldenFieldPicker({
  draft,
  update,
  datasetColumns,
}: {
  draft: SelectBestEvaluatorConfig;
  update: (patch: Partial<SelectBestEvaluatorConfig>) => void;
  datasetColumns: DatasetColumn[];
}) {
  return (
    <Field.Root required flex="1">
      <Field.Label fontSize="13px" color="fg.muted" marginBottom={1}>
        Golden field
      </Field.Label>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            variant="outline"
            colorPalette="gray"
            size="sm"
            fontWeight="normal"
            justifyContent="space-between"
            width="full"
            data-testid="select-best-golden-field"
          >
            <Text
              fontSize="13px"
              color={draft.goldenField ? "fg" : "fg.subtle"}
              truncate
            >
              {draft.goldenField || "Select a dataset column…"}
            </Text>
            <ChevronDown size={14} color="var(--chakra-colors-fg-muted)" />
          </Button>
        </Menu.Trigger>
        <Menu.Content portalled={true} maxHeight="240px" overflowY="auto">
          {datasetColumns.length === 0 ? (
            <Menu.Item value="__empty__" disabled>
              <Text fontSize="13px" color="fg.subtle">
                No options available
              </Text>
            </Menu.Item>
          ) : (
            datasetColumns.map((c) => (
              <Menu.Item
                key={c.id}
                value={c.name}
                onClick={() => update({ goldenField: c.name })}
                data-testid={`select-best-golden-field-option-${c.name}`}
              >
                <Text fontSize="13px">{c.name}</Text>
              </Menu.Item>
            ))
          )}
        </Menu.Content>
      </Menu.Root>
      <Text fontSize="xs" color="fg.muted" marginTop={2}>
        The dataset column that holds the ground-truth answer — usually{" "}
        <Text as="span" fontFamily="mono">
          expected_output
        </Text>
        . The judge compares each candidate against it and picks the closest.
      </Text>
    </Field.Root>
  );
}

/**
 * Inline metric toggles. Source of truth is `settings.include_metrics`
 * (what the Python judge reads); the legacy `selectBest.includeMetrics`
 * mirror is kept in sync on every write so any orchestrator path reading
 * from it doesn't drift. Same dual-representation pattern
 * PairwiseConfigForm uses.
 */
function MetricsSection({
  draft,
  update,
}: {
  draft: SelectBestEvaluatorConfig;
  update: (patch: Partial<SelectBestEvaluatorConfig>) => void;
}) {
  const formContext = useFormContext<{
    settings?: { include_metrics?: Metric[] };
  }>();
  const watchedMetrics = useWatch({
    control: formContext?.control,
    name: "settings.include_metrics",
  }) as Metric[] | undefined;
  const current = (watchedMetrics ?? draft.includeMetrics ?? []) as Metric[];

  const toggle = useCallback(
    (metric: Metric, on: boolean) => {
      const next = on
        ? Array.from(new Set([...current, metric]))
        : current.filter((m) => m !== metric);
      formContext?.setValue("settings.include_metrics", next, {
        shouldDirty: true,
        shouldTouch: true,
      });
      update({ includeMetrics: next });
    },
    [current, formContext, update],
  );

  return (
    <Box paddingTop={2}>
      <Text
        fontSize="11px"
        fontWeight="bold"
        textTransform="uppercase"
        letterSpacing="wide"
        color="fg.muted"
        marginBottom={2}
      >
        Include metrics
      </Text>
      <VStack align="stretch" gap={2}>
        <HStack justify="space-between">
          <Text fontSize="13px">Include cost</Text>
          <Switch
            checked={current.includes("cost")}
            onCheckedChange={({ checked }) => toggle("cost", checked)}
            data-testid="select-best-include-cost"
          />
        </HStack>
        <HStack justify="space-between">
          <Text fontSize="13px">Include duration</Text>
          <Switch
            checked={current.includes("duration")}
            onCheckedChange={({ checked }) => toggle("duration", checked)}
            data-testid="select-best-include-duration"
          />
        </HStack>
      </VStack>
      <Text fontSize="xs" color="fg.muted" marginTop={2}>
        Inject per-candidate cost / latency into the judge prompt so it can
        prefer the cheaper / faster variant when quality is comparable.
      </Text>
    </Box>
  );
}
