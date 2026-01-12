import { Card, type CardRootProps, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import React from "react";
import { useColorModeValue } from "../../components/ui/color-mode";
import { SelectableIconCard } from "../../features/onboarding/components/sections/shared/SelectableIconCard";
import { Tooltip } from "../ui/tooltip";
import { PuzzleIcon } from "../icons/PuzzleIcon";
import { LANGUAGE_OPTIONS, type LanguageKey } from "./techStackOptions";

interface LanguageGridProps {
  selectedLanguage: LanguageKey;
  onSelectLanguage: (language: LanguageKey) => void;
}

/**
 * Renders a card with PuzzleIcon for the "Other" option.
 * This is needed because SelectableIconCard expects IconData (image URLs),
 * but PuzzleIcon is a React SVG component.
 */
function OtherOptionCard(props: {
  label: string;
  selected: boolean;
  onClick: () => void;
  ariaLabel: string;
}): React.ReactElement {
  const { label, selected, onClick, ariaLabel } = props;

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
          <Icon size="lg" color="fg.muted">
            <PuzzleIcon />
          </Icon>
        </VStack>
      </Card.Root>
    </Tooltip>
  );
}

export function LanguageGrid(props: LanguageGridProps): React.ReactElement {
  const { selectedLanguage, onSelectLanguage } = props;

  return (
    <VStack align="stretch" gap={2}>
      <Text textStyle="sm" fontWeight="medium" color="fg.muted">
        Select your platform or language
      </Text>
      <HStack gap={2} wrap="wrap">
        {LANGUAGE_OPTIONS.map((lang) =>
          lang.key === "other" ? (
            <OtherOptionCard
              key={lang.key}
              label={lang.label}
              selected={selectedLanguage === lang.key}
              onClick={() => onSelectLanguage(lang.key)}
              ariaLabel={`${lang.label} language`}
            />
          ) : (
            <SelectableIconCard
              key={lang.key}
              label={lang.label}
              icon={lang.icon}
              size="sm"
              iconSize="lg"
              selected={selectedLanguage === lang.key}
              onClick={() => onSelectLanguage(lang.key)}
              ariaLabel={`${lang.label} language`}
            />
          )
        )}
      </HStack>
    </VStack>
  );
}
