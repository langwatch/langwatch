"use client";

import { createListCollection, HStack, Text } from "@chakra-ui/react";
import * as React from "react";

import { Select } from "./select.tsx";

/** The pseudo-label that always follows the newest version. */
export const DEPLOY_LABEL_LATEST = "latest";

/** A deploy label the picker offers, and the version it points at. */
export interface DeployLabelOption {
  label: string;
  version: number;
}

export interface DeployLabelSelectProps {
  /** The picked label; absent or `latest` means the newest version. */
  value: string | undefined;
  /** Called with the picked label, or undefined for `latest`. */
  onChange: (label: string | undefined) => void;
  /** The labels deployed on the agent or evaluator, each with its version. */
  labels: DeployLabelOption[];
  latestVersion: number | null;
  disabled?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
}

type Item = { value: string; label: string; version: number | null };

function itemsOf({
  labels,
  latestVersion,
  value,
}: Pick<DeployLabelSelectProps, "labels" | "latestVersion" | "value">): Item[] {
  const items: Item[] = [
    { value: DEPLOY_LABEL_LATEST, label: DEPLOY_LABEL_LATEST, version: latestVersion },
    ...labels
      .filter((option) => option.label !== DEPLOY_LABEL_LATEST)
      .map((option) => ({ value: option.label, label: option.label, version: option.version })),
  ];
  // A pinned label that was removed stays visible, so the picker never hides what is saved.
  if (value && !items.some((item) => item.value === value)) {
    items.push({ value, label: value, version: null });
  }
  return items;
}

function ItemText({ item }: { item: Item }) {
  return (
    <HStack gap={2} justify="space-between" width="full">
      <Text as="span" fontSize="sm" fontWeight="medium">
        {item.label}
      </Text>
      <Text as="span" fontSize="sm" color="fg.muted" fontFamily="mono">
        {item.version === null ? "not deployed" : `v${item.version}`}
      </Text>
    </HStack>
  );
}

/** Picks which deploy label of an agent or evaluator runs: `latest` or a deployed label. */
export function DeployLabelSelect(props: DeployLabelSelectProps) {
  const { value, onChange, labels, latestVersion } = props;
  const items = React.useMemo(
    () => itemsOf({ labels, latestVersion, value }),
    [labels, latestVersion, value],
  );
  const collection = React.useMemo(() => createListCollection({ items }), [items]);
  const selected = value ?? DEPLOY_LABEL_LATEST;

  return (
    <Select.Root
      collection={collection}
      size="sm"
      value={[selected]}
      disabled={props.disabled}
      onValueChange={(details) => {
        const next = details.value[0];
        onChange(!next || next === DEPLOY_LABEL_LATEST ? undefined : next);
      }}
    >
      <Select.Trigger
        aria-label={props["aria-label"] ?? "Deploy label"}
        data-testid={props["data-testid"]}
      >
        <Select.ValueText placeholder={DEPLOY_LABEL_LATEST}>
          {(picked) => {
            const item = picked[0] as Item | undefined;
            return item ? <ItemText item={item} /> : DEPLOY_LABEL_LATEST;
          }}
        </Select.ValueText>
      </Select.Trigger>
      <Select.Content>
        {items.map((item) => (
          <Select.Item key={item.value} item={item}>
            <ItemText item={item} />
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
