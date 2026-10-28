import { Menu } from "@langwatch/design-system/menu";
import { Box, Text } from "@langwatch/design-system/primitives";
import { History } from "lucide-react";

import type { DatasetVersionOption } from "../../../behavior/experiments-v3/use-dataset-version-options.ts";

const LATEST = "latest";

export const DATASET_VERSION_PIN_HINT =
  "Runs started from the API, CI or an SDK read this version. Runs started on this page use the rows shown here.";

/** How one version reads in the menu: its number, then its name when it has one. */
export const datasetVersionLabel = ({ version, name }: DatasetVersionOption): string =>
  name ? `Version ${version} · ${name}` : `Version ${version}`;

/** The short pin a dataset tab shows: "v3", or nothing for the latest content. */
export const datasetVersionBadge = (version: number | null | undefined): string | null =>
  version ? `v${version}` : null;

/**
 * The saved dataset version an experiment's runs read, as a submenu of the dataset tab's
 * menu, so the dataset header takes no extra room.
 * Spec: specs/experiments-v3/dataset-version-pin.feature.
 */
export function DatasetVersionSubmenu({
  versions,
  value,
  onChange,
}: {
  versions: DatasetVersionOption[];
  /** The pinned version; absent or null reads the latest content. */
  value: number | null | undefined;
  onChange: (version: number | null) => void;
}) {
  const pinned = value ?? null;
  // A pinned version the history no longer lists still shows as pinned.
  const options =
    pinned !== null && !versions.some((option) => option.version === pinned)
      ? [{ version: pinned, name: null }, ...versions]
      : versions;

  return (
    <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
      <Menu.TriggerItem value="dataset-version" data-testid="experiment-dataset-version">
        <History size={14} />
        Dataset version ({pinned === null ? "Latest" : `v${pinned}`})
      </Menu.TriggerItem>
      <Menu.Content minWidth="220px" maxWidth="320px">
        <Box paddingX={2} paddingY={1.5}>
          <Text textStyle="caption" color="fg.muted">
            {DATASET_VERSION_PIN_HINT}
          </Text>
        </Box>
        <Menu.RadioItemGroup
          value={pinned === null ? LATEST : String(pinned)}
          onValueChange={(event) => onChange(event.value === LATEST ? null : Number(event.value))}
        >
          <Menu.RadioItem value={LATEST}>Latest version</Menu.RadioItem>
          {options.map((option) => (
            <Menu.RadioItem key={option.version} value={String(option.version)}>
              {datasetVersionLabel(option)}
            </Menu.RadioItem>
          ))}
        </Menu.RadioItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
}
