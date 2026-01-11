import { Box, Card, type CardRootProps, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useColorModeValue } from "../../components/ui/color-mode";
import { SelectableIconCard } from "../../features/onboarding/components/sections/shared/SelectableIconCard";
import { Tooltip } from "../ui/tooltip";
import { PuzzleIcon } from "../icons/PuzzleIcon";
import { Vercel } from "../icons/Vercel";
import {
  getFrameworksForLanguage,
  type FrameworkKey,
  type LanguageKey,
} from "./techStackOptions";

interface FrameworkGridProps {
  selectedLanguage: LanguageKey;
  selectedFramework: FrameworkKey;
  onSelectFramework: (framework: FrameworkKey) => void;
}

/**
 * Renders a card with a React component icon.
 * Used for icons that are React components (PuzzleIcon, Vercel)
 * instead of image URLs that SelectableIconCard expects.
 */
function ReactIconCard(props: {
  label: string;
  selected: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { label, selected, onClick, ariaLabel, children } = props;

  const borderColor = useColorModeValue<CardRootProps["borderColor"]>(
    "border.inverted/10",
    "border.inverted/30",
  );
  const selectedBorderColor = useColorModeValue(
    "orange.400",
    "orange.300",
  );
  const selectedBg = useColorModeValue(
    "orange.50",
    "orange.950/30",
  );

  return (
    <Tooltip
      content={label}
      positioning={{ placement: "bottom" }}
      showArrow
      openDelay={0}
    >
      <Card.Root
        role="button"
        aria-label={ariaLabel}
        aria-pressed={selected}
        onClick={onClick}
        cursor="pointer"
        borderWidth={selected ? "2px" : "1px"}
        borderColor={selected ? selectedBorderColor : borderColor}
        bg={selected ? selectedBg : "bg.subtle/30"}
        transition="all 0.2s ease"
        aspectRatio="1 / 1"
        display="flex"
        maxW="75px"
        minW="65px"
        alignItems="center"
        justifyContent="center"
      >
        <VStack
          filter={selected ? "grayscale(0%)" : "grayscale(100%)"}
          transition="filter 0.2s ease"
          alignItems="center"
          justifyContent="center"
          gap="0"
        >
          <Box width="32px" height="32px" display="flex" alignItems="center" justifyContent="center">
            {children}
          </Box>
        </VStack>
      </Card.Root>
    </Tooltip>
  );
}

/**
 * Map of framework keys to their React component icons.
 * These icons cannot use SelectableIconCard because they are React components,
 * not image URLs.
 */
const REACT_ICON_FRAMEWORKS: Record<string, React.ReactNode> = {
  other: <PuzzleIcon />,
  vercel_ai: <Vercel />,
};

export function FrameworkGrid(props: FrameworkGridProps): React.ReactElement {
  const { selectedLanguage, selectedFramework, onSelectFramework } = props;

  const frameworks = getFrameworksForLanguage(selectedLanguage);

  return (
    <VStack align="stretch" gap={2}>
      <Text textStyle="sm" fontWeight="medium" color="fg.muted">
        Library or Framework
      </Text>
      <HStack gap={2} wrap="wrap">
        {frameworks.map((fw) => {
          const reactIcon = REACT_ICON_FRAMEWORKS[fw.key];
          
          if (reactIcon) {
            return (
              <ReactIconCard
                key={fw.key}
                label={fw.label}
                selected={selectedFramework === fw.key}
                onClick={() => onSelectFramework(fw.key)}
                ariaLabel={`${fw.label} framework`}
              >
                {reactIcon}
              </ReactIconCard>
            );
          }
          
          return (
            <SelectableIconCard
              key={fw.key}
              label={fw.label}
              icon={fw.icon}
              size="sm"
              iconSize="lg"
              selected={selectedFramework === fw.key}
              onClick={() => onSelectFramework(fw.key)}
              ariaLabel={`${fw.label} framework`}
            />
          );
        })}
      </HStack>
    </VStack>
  );
}
