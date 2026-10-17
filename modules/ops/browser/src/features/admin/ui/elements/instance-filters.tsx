import { createListCollection, HStack } from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";

import {
  ACTIVITY_LABELS,
  SIGNAL_LABELS,
  SORT_LABELS,
  type SelfHostedInstanceFilters,
} from "../../model/self-hosted-instance.ts";

const ANY = "any";

const sortOptions = createListCollection({
  items: Object.entries(SORT_LABELS).map(([value, label]) => ({ value, label })),
});
const licenseOptions = createListCollection({
  items: [
    { value: ANY, label: "Any license" },
    { value: "licensed", label: "Licensed" },
    { value: "open_source", label: "Open source" },
  ],
});
const activityOptions = createListCollection({
  items: [
    { value: ANY, label: "Any activity" },
    ...Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label })),
  ],
});
const signalOptions = createListCollection({
  items: [
    { value: ANY, label: "Any signal" },
    ...Object.entries(SIGNAL_LABELS).map(([value, label]) => ({ value, label })),
  ],
});

/** The order and the narrowing the operator picked for the installs list. */
export function InstanceFilters({
  value,
  onChange,
}: {
  value: SelfHostedInstanceFilters;
  onChange: (next: SelfHostedInstanceFilters) => void;
}) {
  return (
    <HStack gap={2} wrap="wrap">
      <FilterSelect
        label="Sort by"
        collection={sortOptions}
        value={value.sort}
        onValue={(picked) => {
          const sort = optionalKeyOf(SORT_LABELS, picked);
          if (sort) onChange({ ...value, sort });
        }}
      />
      <FilterSelect
        label="License"
        collection={licenseOptions}
        value={value.license ?? ANY}
        onValue={(license) =>
          onChange({
            ...value,
            license: license === "licensed" || license === "open_source" ? license : undefined,
          })
        }
      />
      <FilterSelect
        label="Activity"
        collection={activityOptions}
        value={value.activity ?? ANY}
        onValue={(activity) =>
          onChange({ ...value, activity: optionalKeyOf(ACTIVITY_LABELS, activity) })
        }
      />
      <FilterSelect
        label="Signal"
        collection={signalOptions}
        value={value.signal ?? ANY}
        onValue={(signal) => onChange({ ...value, signal: optionalKeyOf(SIGNAL_LABELS, signal) })}
      />
    </HStack>
  );
}

function FilterSelect({
  label,
  collection,
  value,
  onValue,
}: {
  label: string;
  collection: ReturnType<typeof createListCollection<{ value: string; label: string }>>;
  value: string;
  onValue: (value: string) => void;
}) {
  return (
    <Select.Root
      size="sm"
      width="auto"
      minWidth="160px"
      collection={collection}
      value={[value]}
      onValueChange={(change) => {
        const [picked] = change.value;
        if (picked) onValue(picked);
      }}
    >
      <Select.Trigger aria-label={label}>
        <Select.ValueText placeholder={label} />
      </Select.Trigger>
      <Select.Content>
        {collection.items.map((item) => (
          <Select.Item key={item.value} item={item}>
            {item.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

function optionalKeyOf<K extends string>(labels: Record<K, string>, value: string): K | undefined {
  return Object.keys(labels).find((key): key is K => key === value);
}
