import { Badge, HStack, Text } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";

type VersionBadgeProps = {
  /** Current version number */
  version: number;
  /** Latest version from DB (if provided, enables outdated detection) */
  latestVersion?: number;
  /** Callback when user clicks to upgrade to latest */
  onUpgrade?: () => void;
};

/**
 * Displays a version badge with optional outdated detection.
 * When latestVersion > version, shows an upgrade prompt with arrow transition.
 */
export function VersionBadge({
  version,
  latestVersion,
  onUpgrade,
}: VersionBadgeProps) {
  const isOutdated = latestVersion !== undefined && latestVersion > version;

  if (isOutdated && onUpgrade) {
    return (
      <Tooltip
        content="This prompt is outdated, click to use the latest version"
        positioning={{ placement: "top" }}
        showArrow
      >
        <HStack
          gap={1}
          fontSize="sm"
          flexWrap="nowrap"
          onClick={(e) => {
            e.stopPropagation();
            onUpgrade();
          }}
          cursor="pointer"
          _hover={{ opacity: 0.8 }}
          data-testid="version-badge-outdated"
          role="button"
        >
          <Badge colorPalette="gray" textTransform="none">
            v{version}
          </Badge>
          <Text>→</Text>
          <Badge colorPalette="green" textTransform="none">
            v{latestVersion}
          </Badge>
        </HStack>
      </Tooltip>
    );
  }

  return (
    <Badge colorPalette="gray" data-testid="version-badge">
      v{version}
    </Badge>
  );
}
