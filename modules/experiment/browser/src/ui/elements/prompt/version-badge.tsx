import { Badge, chakra, Text } from "@langwatch/design-system/primitives";
import { RawTooltip as Tooltip } from "@langwatch/design-system/tooltip";

type VersionBadgeProps = {
  version: number;
  latestVersion?: number;
  onUpgrade?: () => void;
};

export function VersionBadge({ version, latestVersion, onUpgrade }: VersionBadgeProps) {
  const isOutdated = latestVersion !== undefined && latestVersion > version;
  if (isOutdated && onUpgrade)
    return (
      <Tooltip.Root positioning={{ placement: "top" }}>
        <Tooltip.Trigger asChild>
          <chakra.button
            type="button"
            display="flex"
            alignItems="center"
            gap={1}
            fontSize="sm"
            flexWrap="nowrap"
            onClick={(event) => {
              event.stopPropagation();
              onUpgrade();
            }}
            cursor="pointer"
            _hover={{ opacity: 0.8 }}
            data-testid="version-badge-outdated"
          >
            <Badge colorPalette="gray" textTransform="none">
              v{version}
            </Badge>
            <Text>→</Text>
            <Badge colorPalette="green" textTransform="none">
              v{latestVersion}
            </Badge>
          </chakra.button>
        </Tooltip.Trigger>
        <Tooltip.Positioner>
          <Tooltip.Content>
            This prompt is outdated, click to use the latest version
            <Tooltip.Arrow>
              <Tooltip.ArrowTip />
            </Tooltip.Arrow>
          </Tooltip.Content>
        </Tooltip.Positioner>
      </Tooltip.Root>
    );
  return (
    <Badge colorPalette="gray" data-testid="version-badge">
      v{version}
    </Badge>
  );
}
