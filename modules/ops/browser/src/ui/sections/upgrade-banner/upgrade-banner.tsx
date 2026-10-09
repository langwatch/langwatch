import { chakra, HStack, Skeleton, Text } from "@langwatch/design-system/primitives";
import type React from "react";

import { toneOf, tonePalette } from "../../../features/upgrades/model/upgrade-labels.ts";
import type { UpgradeStatusView } from "../../../features/upgrades/model/upgrade-view.ts";

/** The installation states that wait on an operator (modules/ops/specs/upgrade-alerts.feature). */
const NEEDS_OPERATOR = new Set(["behind", "unsupported", "needs-attention"]);

export interface UpgradeBannerProps {
  /** The `ops.upgrade.status` answer; absent while loading or when the read failed. */
  status: Pick<UpgradeStatusView, "state" | "label" | "tone"> | undefined;
  loading: boolean;
  /** Opens the Upgrades page; the mounting feature decides how it navigates. */
  onOpen: () => void;
}

export const UpgradeBanner = ({ status, loading, onOpen }: UpgradeBannerProps) => {
  if (loading) {
    return (
      <Skeleton
        data-testid="upgrade-banner-loading"
        height="32px"
        width="180px"
        borderRadius="full"
      />
    );
  }
  if (!status || !NEEDS_OPERATOR.has(status.state)) return null;

  return (
    <HStack
      colorPalette={tonePalette(toneOf(status.tone))}
      fontSize="12px"
      fontWeight="bold"
      color="colorPalette.contrast"
      background="colorPalette.solid"
      borderRadius="full"
      height="32px"
      paddingX={3}
      gap={2}
      flexShrink={0}
    >
      <Text fontSize="12px" lineClamp={1}>
        Upgrade: {status.label}
      </Text>
      <chakra.a
        href="#"
        onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
          e.preventDefault();
          onOpen();
        }}
        fontSize="11px"
        fontWeight="bold"
        color="colorPalette.contrast"
        background="whiteAlpha.300"
        borderRadius="full"
        paddingX={2}
        paddingY="2px"
        cursor="pointer"
        _hover={{ background: "whiteAlpha.400" }}
      >
        Open Upgrades
      </chakra.a>
    </HStack>
  );
};
