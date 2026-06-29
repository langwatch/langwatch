/**
 * ColumnTypeSelect — a pretty, icon-led picker for a dataset column's type.
 *
 * Replaces the bare `<NativeSelect>` (OS-native, unstyleable) with the
 * codebase-standard Chakra `Select`, rendering each option as its
 * {@link ColumnTypeIcon} + a friendly label. Drop-in for any column-type field;
 * the trigger forwards `aria-label` so it stays labelled for tests + AT.
 */
import { createListCollection, HStack, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import type { DatasetColumnType } from "~/server/datasets/types";
import { Select } from "../ui/select";
import { ColumnTypeIcon } from "./ColumnTypeIcon";

type ColumnTypeOption = { value: DatasetColumnType; label: string };

/** The column types offered at upload/confirm time, with friendly labels. The
 *  `value` is the stored type string; the label is display-only. */
export const COLUMN_TYPE_OPTIONS: ColumnTypeOption[] = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
  { value: "list", label: "List" },
  { value: "json", label: "JSON" },
  { value: "image", label: "Image (URL)" },
];

const OptionContent = ({ value, label }: ColumnTypeOption) => (
  <HStack gap={2} minW={0}>
    <ColumnTypeIcon type={value} size={14} />
    <Text truncate>{label}</Text>
  </HStack>
);

export function ColumnTypeSelect({
  value,
  onChange,
  "aria-label": ariaLabel,
  size = "sm",
  width = "44",
}: {
  value: DatasetColumnType;
  onChange: (type: DatasetColumnType) => void;
  "aria-label"?: string;
  size?: "xs" | "sm" | "md";
  width?: string;
}) {
  const collection = useMemo(
    () => createListCollection({ items: COLUMN_TYPE_OPTIONS }),
    [],
  );

  return (
    <Select.Root
      collection={collection}
      value={[value]}
      onValueChange={(details) => {
        const next = details.value[0];
        if (next) onChange(next as DatasetColumnType);
      }}
      size={size}
      width={width}
    >
      <Select.Trigger aria-label={ariaLabel}>
        <Select.ValueText placeholder="Type">
          {(items) => {
            const item = items[0] as ColumnTypeOption | undefined;
            return item ? <OptionContent {...item} /> : null;
          }}
        </Select.ValueText>
      </Select.Trigger>
      <Select.Content>
        {COLUMN_TYPE_OPTIONS.map((option) => (
          <Select.Item key={option.value} item={option}>
            <OptionContent {...option} />
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
