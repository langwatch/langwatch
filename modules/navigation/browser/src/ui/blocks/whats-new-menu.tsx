/**
 * "What's new" at the navigation foot: the public changelog's latest entry in a card above
 * the button, with a dot until it is opened. Hidden when there is no entry.
 * Spec: modules/navigation/specs/whats-new.feature
 */
import { Popover } from "@langwatch/design-system/popover";
import {
  Box,
  Button,
  Circle,
  Image,
  Link,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useState } from "react";
import { LuArrowRight, LuLayers, LuPackageOpen, LuRocket, LuSparkles, LuZap } from "react-icons/lu";

import { useWhatsNew } from "../../behavior/use-whats-new.ts";
import { useSideMenuDensity } from "../elements/side-menu-density.tsx";
import { SideMenuItem } from "./side-menu-link.tsx";

const FEATURE_ICONS = [LuSparkles, LuZap, LuLayers, LuRocket];

export function WhatsNewMenu({ showLabel = true }: { showLabel?: boolean }) {
  const { entries, unseen, markSeen } = useWhatsNew();
  const [isOpen, setIsOpen] = useState(false);
  const density = useSideMenuDensity();
  const [entry] = entries;
  if (!entry) return null;

  const icon = (
    <Box position="relative" display="flex">
      <LuPackageOpen size={density.iconSize} color="var(--chakra-colors-blue-fg)" />
      {unseen && (
        <Circle
          data-testid="whats-new-dot"
          size="7px"
          bg="blue.solid"
          position="absolute"
          top="-2px"
          right="-3px"
          borderWidth="1px"
          borderColor="bg.page"
        />
      )}
    </Box>
  );

  return (
    <Popover.Root
      positioning={{ placement: "top-start" }}
      open={isOpen}
      onOpenChange={({ open }) => {
        setIsOpen(open);
        if (open) markSeen();
      }}
    >
      <Tooltip
        content="Hot and fresh features"
        positioning={{ placement: "right" }}
        disabled={isOpen}
      >
        <Box display={showLabel ? "block" : "inline-block"} width={showLabel ? "full" : "auto"}>
          <Popover.Trigger asChild>
            <Box
              as="button"
              width={showLabel ? "full" : "auto"}
              textAlign="left"
              cursor="pointer"
              aria-label="What's new"
            >
              <SideMenuItem
                icon={icon}
                label="What's new"
                isActive={isOpen}
                showLabel={showLabel}
              />
            </Box>
          </Popover.Trigger>
        </Box>
      </Tooltip>
      <Popover.Content width="320px" padding={4}>
        <VStack align="stretch" gap={3}>
          <VStack align="stretch" gap={1}>
            <Text fontSize="xs" fontWeight="semibold" color="blue.fg">
              What's new
            </Text>
            <Text fontSize="md" fontWeight="bold" lineHeight="short">
              {entry.title}
            </Text>
          </VStack>
          {entry.imageUrl && (
            <Image
              src={entry.imageUrl}
              alt={entry.title}
              referrerPolicy="no-referrer"
              borderRadius="md"
              borderWidth="1px"
              borderColor="border"
              width="full"
            />
          )}
          {entry.features.length > 0 && (
            <VStack align="stretch" gap={0}>
              {entry.features.map((feature, index) => {
                const FeatureIcon = FEATURE_ICONS[index % FEATURE_ICONS.length] ?? LuSparkles;
                return (
                  <Link
                    key={feature.text}
                    href={feature.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    display="flex"
                    alignItems="center"
                    gap={2}
                    paddingX={2}
                    paddingY={1.5}
                    marginX={-2}
                    borderRadius="md"
                    fontSize="sm"
                    color="fg"
                    _hover={{ backgroundColor: "bg.muted", textDecoration: "none" }}
                  >
                    <Box color="blue.fg" flexShrink={0}>
                      <FeatureIcon size={14} />
                    </Box>
                    {feature.text}
                  </Link>
                );
              })}
            </VStack>
          )}
          <Button asChild colorPalette="blue" width="full" size="sm">
            <a href={entry.url} target="_blank" rel="noopener noreferrer">
              Read the update <LuArrowRight />
            </a>
          </Button>
        </VStack>
      </Popover.Content>
    </Popover.Root>
  );
}
