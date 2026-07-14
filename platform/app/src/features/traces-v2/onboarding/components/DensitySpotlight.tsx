import {
  Box,
  chakra,
  HStack,
  Icon,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AArrowDown, AArrowUp, Check } from "lucide-react";
import type React from "react";
import { type Density, useDensityStore } from "../../stores/densityStore";

interface DensityChoice {
  value: Density;
  label: string;
  hint: string;
  icon: typeof AArrowDown;
  /** Vertical gap between bars in the multi-row preview. */
  rowGap: string;
  /** Height of each preview bar — proxies "row height" visually. */
  rowHeight: string;
  /** How many bars to stack inside the preview. */
  rowCount: number;
}

const DENSITY_CHOICES: DensityChoice[] = [
  {
    value: "compact",
    label: "Compact",
    hint: "More rows on screen.",
    icon: AArrowDown,
    rowGap: "3px",
    rowHeight: "6px",
    rowCount: 5,
  },
  {
    value: "comfortable",
    label: "Comfortable",
    hint: "Room to breathe.",
    icon: AArrowUp,
    rowGap: "9px",
    rowHeight: "9px",
    rowCount: 3,
  },
];

const DensityCardButton = chakra("button", {
  base: {
    textAlign: "left",
    cursor: "pointer",
    transition: "all 160ms ease",
    width: "full",
  },
});

interface DensitySpotlightProps {
  /**
   * The density value the user has clicked during the spotlight stage,
   * or `null` if they haven't engaged yet. Click-to-pick sets this;
   * clicking the *same* card again triggers `onContinue`. Lifted to
   * the parent so the spotlight knows which card to render with the
   * `Continue →` chip.
   */
  pickedValue: Density | null;
  onPick: (value: Density) => void;
  onContinue: () => void;
}

/**
 * Side-by-side density preview cards. Each card stacks N bars at its
 * target spacing so the per-row contrast reads at a glance — Compact
 * packs more rows tighter, Comfortable gives each row breathing room.
 * Clicking a card commits the density to the global store; the live
 * table behind reflows in real time.
 */
export function DensitySpotlight({
  pickedValue,
  onPick,
  onContinue,
}: DensitySpotlightProps): React.ReactElement {
  const density = useDensityStore((s) => s.density);
  const setDensity = useDensityStore((s) => s.setDensity);

  const handleCardClick = (value: Density) => {
    if (value === pickedValue) {
      // Second click on the already-picked card: advance.
      onContinue();
      return;
    }
    setDensity(value);
    onPick(value);
  };

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} gap={2.5} width="full">
      {DENSITY_CHOICES.map((choice) => {
        const isActive = density === choice.value;
        const isPicked = pickedValue === choice.value;
        return (
          <DensityCardButton
            key={choice.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => handleCardClick(choice.value)}
            padding={3}
            borderRadius="lg"
            borderWidth="1px"
            borderColor={isActive ? "orange.solid" : "border.muted"}
            background={isActive ? "orange.subtle" : "bg.panel/60"}
            _hover={
              isActive
                ? undefined
                : {
                    borderColor: "border.emphasized",
                    background: "bg.panel",
                  }
            }
          >
            <VStack align="stretch" gap={2}>
              <HStack justify="space-between" align="center">
                <HStack gap={2}>
                  <Icon
                    boxSize={3.5}
                    color={isActive ? "orange.fg" : "fg.muted"}
                  >
                    <choice.icon />
                  </Icon>
                  <Text textStyle="sm" fontWeight={500} color="fg">
                    {choice.label}
                  </Text>
                </HStack>
                {isPicked ? (
                  <HStack
                    gap={1}
                    paddingX={1.5}
                    paddingY={0.5}
                    borderRadius="full"
                    background="orange.solid"
                    color="orange.contrast"
                  >
                    <Text textStyle="2xs" fontWeight={600}>
                      Continue
                    </Text>
                    <Text aria-hidden as="span" textStyle="2xs">
                      →
                    </Text>
                  </HStack>
                ) : isActive ? (
                  <HStack
                    gap={1}
                    paddingX={1.5}
                    paddingY={0.5}
                    borderRadius="full"
                    background="orange.subtle"
                    color="orange.fg"
                    borderWidth="1px"
                    borderColor="orange.muted"
                  >
                    <Icon boxSize={2.5}>
                      <Check />
                    </Icon>
                    <Text textStyle="2xs" fontWeight={600}>
                      Current
                    </Text>
                  </HStack>
                ) : null}
              </HStack>

              <DensityRowsPreview choice={choice} active={isActive} />

              <Text textStyle="2xs" color="fg.muted" lineHeight={1.4}>
                {choice.hint}
              </Text>
            </VStack>
          </DensityCardButton>
        );
      })}
    </SimpleGrid>
  );
}

interface DensityRowsPreviewProps {
  choice: DensityChoice;
  active: boolean;
}

const DensityRowsPreview: React.FC<DensityRowsPreviewProps> = ({
  choice,
  active,
}) => (
  <Box
    borderRadius="md"
    borderWidth="1px"
    borderColor={active ? "orange.muted" : "border.muted"}
    background="bg.surface"
    paddingX={2.5}
    paddingY={2.5}
    height="92px"
    overflow="hidden"
  >
    <VStack align="stretch" gap={choice.rowGap}>
      {Array.from({ length: choice.rowCount }).map((_, i) => (
        <HStack key={i} gap={2} align="center">
          <Box
            height={choice.rowHeight}
            width="22%"
            borderRadius="sm"
            bg="border.emphasized"
            opacity={0.7}
          />
          <Box
            height={choice.rowHeight}
            flex={1}
            borderRadius="sm"
            bg="border.muted"
          />
          <Box
            height={choice.rowHeight}
            width="14%"
            borderRadius="sm"
            bg="border.muted"
          />
        </HStack>
      ))}
    </VStack>
  </Box>
);
