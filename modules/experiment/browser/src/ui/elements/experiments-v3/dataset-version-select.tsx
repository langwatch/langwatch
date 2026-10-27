import { HStack, NativeSelect, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import type { DatasetVersionOption } from "../../../behavior/experiments-v3/use-dataset-version-options.ts";

const LATEST = "latest";

export const DATASET_VERSION_PIN_HINT =
  "Runs started from the API, CI or an SDK read this version. Runs started on this page use the rows shown here.";

/** How one version reads in the select: its number, then its name when it has one. */
export const datasetVersionLabel = ({ version, name }: DatasetVersionOption): string =>
  name ? `Version ${version} · ${name}` : `Version ${version}`;

/**
 * The saved dataset version an experiment's runs read: Latest, or one pinned version.
 * Spec: specs/experiments-v3/dataset-version-pin.feature.
 */
export function DatasetVersionSelect({
  versions,
  value,
  onChange,
  disabled,
}: {
  versions: DatasetVersionOption[];
  /** The pinned version; absent or null reads the latest content. */
  value: number | null | undefined;
  onChange: (version: number | null) => void;
  disabled?: boolean;
}) {
  const pinned = value ?? null;
  // A pinned version the history no longer lists still shows as pinned.
  const options =
    pinned !== null && !versions.some((option) => option.version === pinned)
      ? [{ version: pinned, name: null }, ...versions]
      : versions;

  return (
    <HStack gap={1.5} flexShrink={0}>
      <Tooltip content={DATASET_VERSION_PIN_HINT} positioning={{ placement: "top" }} showArrow>
        <Text textStyle="caption" color="fg.muted">
          Dataset version
        </Text>
      </Tooltip>
      <NativeSelect.Root size="xs" width="200px" disabled={disabled}>
        <NativeSelect.Field
          aria-label="Dataset version"
          data-testid="experiment-dataset-version"
          value={pinned === null ? LATEST : String(pinned)}
          onChange={(event) => {
            const selected = event.currentTarget.value;
            onChange(selected === LATEST ? null : Number(selected));
          }}
        >
          <option value={LATEST}>Latest</option>
          {options.map((option) => (
            <option key={option.version} value={String(option.version)}>
              {datasetVersionLabel(option)}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </HStack>
  );
}
