import { Button, Field, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { Menu } from "~/components/ui/menu";

import { useTargetName } from "../../hooks/useTargetName";
import type { PairwiseEvaluatorConfig, TargetConfig } from "../../types";

/**
 * Configuration form for the langevals/pairwise_compare evaluator
 * (#5100). Three required selects:
 *
 *   1. Variant A   — id of an existing TargetConfig
 *   2. Variant B   — id of a different existing TargetConfig
 *   3. Golden      — name of a dataset column whose value is the
 *                    reference answer
 *
 * Per-candidate metrics (cost / duration) are configured in the
 * settings section above via the schema-driven `include_metrics`
 * toggles — that's the single source of truth the judge prompt reads.
 *
 * Pickers use the project's Menu-button pattern (see FieldTypeSelect
 * for the canonical reference) so the drawer reads as a peer of the
 * other LangWatch surfaces instead of a browser-native control.
 *
 * Variant labels come from `useTargetName`, the same reactive hook the
 * column header uses — so the dropdown shows the prompt/agent name
 * ("say-hi"), not the internal target_NNNN id.
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

/**
 * One row inside a Variant A/B menu. Lives in its own component so each
 * row owns its own `useTargetName` hook call — calling the hook inside
 * a .map() over `targets` would break the rules of hooks when the list
 * grows or shrinks between renders.
 */
const VariantMenuItem = ({
  target,
  onSelect,
  testId,
}: {
  target: TargetConfig;
  onSelect: (id: string) => void;
  testId?: string;
}) => {
  const name = useTargetName(target);
  const label = name || target.id;
  return (
    <Menu.Item
      value={target.id}
      onClick={() => onSelect(target.id)}
      data-testid={testId}
    >
      <Text fontSize="13px">{label}</Text>
    </Menu.Item>
  );
};

/**
 * Inline label for the selected variant inside the picker trigger. Same
 * reactive name resolution as VariantMenuItem.
 */
const SelectedVariantLabel = ({ target }: { target: TargetConfig }) => {
  const name = useTargetName(target);
  return <>{name || target.id}</>;
};

type PickerProps = {
  label: string;
  selectedDisplay: React.ReactNode;
  placeholder: string;
  isEmpty: boolean;
  testId?: string;
  children: React.ReactNode;
};

const Picker = ({
  label,
  selectedDisplay,
  placeholder,
  isEmpty,
  testId,
  children,
}: PickerProps) => (
  <Field.Root required flex="1">
    <Field.Label fontSize="13px" color="fg.muted" marginBottom={1}>
      {label}
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
          data-testid={testId}
        >
          <Text fontSize="13px" color={isEmpty ? "fg.subtle" : "fg"} truncate>
            {isEmpty ? placeholder : selectedDisplay}
          </Text>
          <ChevronDown size={14} color="var(--chakra-colors-fg-muted)" />
        </Button>
      </Menu.Trigger>
      <Menu.Content portalled={true} maxHeight="240px" overflowY="auto">
        {children}
      </Menu.Content>
    </Menu.Root>
  </Field.Root>
);

const EmptyMenuItem = () => (
  <Menu.Item value="__empty__" disabled>
    <Text fontSize="13px" color="fg.subtle">
      No options available
    </Text>
  </Menu.Item>
);

export function PairwiseConfigForm({
  value,
  onChange,
  targets,
  datasetColumns,
}: PairwiseConfigFormProps) {
  // Track the latest config locally so rapid successive picks (e.g. user
  // selects Variant A, then Variant B before the parent re-renders with the
  // new value prop) don't stomp on each other. Without this each `update`
  // spread off the stale `value` prop and only the last pick stuck. We sync
  // back to `value` when the parent intentionally pushes new state in.
  const [draft, setDraft] = useState<PairwiseEvaluatorConfig>(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const update = (patch: Partial<PairwiseEvaluatorConfig>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      onChange(next);
      return next;
    });
  };

  // Variant B options exclude variant A so the user can't pick the same
  // target twice (a pairwise comparison of X vs X is always a tie).
  const variantBOptions = targets.filter((t) => t.id !== draft.variantA);

  const selectedA = targets.find((t) => t.id === draft.variantA);
  const selectedB = targets.find((t) => t.id === draft.variantB);

  return (
    <VStack align="stretch" gap={3} padding={4}>
      <HStack align="end" gap={3}>
        <Picker
          label="Variant A"
          placeholder="Select a target…"
          isEmpty={!selectedA}
          selectedDisplay={
            selectedA ? <SelectedVariantLabel target={selectedA} /> : null
          }
          testId="pairwise-variant-a"
        >
          {targets.length === 0 ? (
            <EmptyMenuItem />
          ) : (
            targets.map((t) => (
              <VariantMenuItem
                key={t.id}
                target={t}
                onSelect={(id) => update({ variantA: id })}
                testId={`pairwise-variant-a-option-${t.id}`}
              />
            ))
          )}
        </Picker>

        <Picker
          label="Variant B"
          placeholder="Select a target…"
          isEmpty={!selectedB}
          selectedDisplay={
            selectedB ? <SelectedVariantLabel target={selectedB} /> : null
          }
          testId="pairwise-variant-b"
        >
          {variantBOptions.length === 0 ? (
            <EmptyMenuItem />
          ) : (
            variantBOptions.map((t) => (
              <VariantMenuItem
                key={t.id}
                target={t}
                onSelect={(id) => update({ variantB: id })}
                testId={`pairwise-variant-b-option-${t.id}`}
              />
            ))
          )}
        </Picker>

        <Picker
          label="Golden field"
          placeholder="Select a dataset column…"
          isEmpty={!draft.goldenField}
          selectedDisplay={<>{draft.goldenField}</>}
          testId="pairwise-golden-field"
        >
          {datasetColumns.length === 0 ? (
            <EmptyMenuItem />
          ) : (
            datasetColumns.map((c) => (
              <Menu.Item
                key={c.id}
                value={c.name}
                onClick={() => update({ goldenField: c.name })}
                data-testid={`pairwise-golden-field-option-${c.name}`}
              >
                <Text fontSize="13px">{c.name}</Text>
              </Menu.Item>
            ))
          )}
        </Picker>
      </HStack>

      <Text fontSize="xs" color="fg.muted">
        Golden field is the reference answer the judge compares each candidate
        against.
      </Text>
    </VStack>
  );
}
