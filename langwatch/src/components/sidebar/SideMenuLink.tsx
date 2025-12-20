import { Badge, Box, HStack, Spacer, Text } from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import React from "react";
import { trackEvent } from "../../utils/tracking";
import { useColorRawValue } from "../ui/color-mode";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";

const MENU_ITEM_HEIGHT = "32px";
const ICON_SIZE = 16;

export type SideMenuLinkProps = {
  icon:
    | React.ComponentType<{ size?: string | number; color?: string }>
    | React.ReactNode;
  label: string;
  href: string;
  project?: Project;
  isActive: boolean;
  badgeNumber?: number;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  showLabel?: boolean;
};

export const SideMenuLink = ({
  icon,
  label,
  href,
  project,
  isActive,
  badgeNumber,
  onClick,
  showLabel = true,
}: SideMenuLinkProps) => {
  const badge =
    badgeNumber && badgeNumber > 0 ? (
      <Badge
        backgroundColor="green.500"
        color="white"
        borderRadius="full"
        paddingX={1.5}
        fontSize="xs"
      >
        {badgeNumber}
      </Badge>
    ) : null;

  const gray600 = useColorRawValue("gray.600");

  const IconElem = icon as React.ComponentType<{
    size?: string | number;
    color?: string;
  }>;
  const iconNode =
    typeof IconElem === "function" ||
    (IconElem as unknown as { render?: unknown }).render ? (
      <IconElem size={ICON_SIZE} color={gray600} />
    ) : (
      (icon as React.ReactNode)
    );

  return (
    <Tooltip
      content={label}
      positioning={{
        placement: "right",
      }}
      disabled={showLabel}
      openDelay={0}
    >
      <Link
        variant="plain"
        width="full"
        href={href}
        aria-label={label}
        onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
          trackEvent("side_menu_click", {
            project_id: project?.id,
            menu_item: label,
          });
          onClick?.(e);
        }}
      >
        <HStack
          width="full"
          height={MENU_ITEM_HEIGHT}
          gap={3}
          paddingX={3}
          borderRadius="lg"
          backgroundColor={isActive ? "gray.200" : "transparent"}
          _hover={{
            backgroundColor: "gray.200",
          }}
          transition="background-color 0.15s ease-in-out"
        >
          <Box
            position="relative"
            flexShrink={0}
            display="flex"
            alignItems="center"
            justifyContent="center"
            width={`${ICON_SIZE}px`}
            height={`${ICON_SIZE}px`}
          >
            {iconNode}
            {badge && !showLabel && (
              <Box position="absolute" top="-6px" right="-10px">
                {badge}
              </Box>
            )}
          </Box>
          {showLabel && (
            <>
              <Text
                fontSize="14px"
                fontWeight="normal"
                color="gray.700"
                whiteSpace="nowrap"
              >
                {label}
              </Text>
              {badge && <Spacer />}
              {badge}
            </>
          )}
        </HStack>
      </Link>
    </Tooltip>
  );
};

