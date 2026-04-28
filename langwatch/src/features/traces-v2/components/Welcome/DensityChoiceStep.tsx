import {
  Box,
  Flex,
  HStack,
  Icon,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AArrowDown, AArrowUp, ArrowRight, Check } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { type Density, useDensityStore } from "../../stores/densityStore";
import type { WelcomeStepProps } from "./steps";

interface DensityOption {
  density: Density;
  label: string;
  blurb: string;
  icon: React.ReactNode;
  accent: "blue" | "purple";
  rowCount: number;
  rowGap: number;
  rowHeight: number;
}

const OPTIONS: DensityOption[] = [
  {
    density: "compact",
    label: "Compact",
    blurb: "Fits more rows on screen.",
    icon: <AArrowDown />,
    accent: "blue",
    rowCount: 9,
    rowGap: 4,
    rowHeight: 6,
  },
  {
    density: "comfortable",
    label: "Comfortable",
    blurb: "More room around each row.",
    icon: <AArrowUp />,
    accent: "purple",
    rowCount: 5,
    rowGap: 10,
    rowHeight: 10,
  },
];

export const DensityChoiceStep: React.FC<WelcomeStepProps> = ({
  markAnswered,
}) => {
  const density = useDensityStore((s) => s.density);
  const setDensity = useDensityStore((s) => s.setDensity);

  return (
    <VStack align="stretch" gap={5}>
      <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
        {OPTIONS.map((option) => (
          <DensityCard
            key={option.density}
            option={option}
            active={density === option.density}
            onSelect={() => {
              setDensity(option.density);
              markAnswered();
            }}
          />
        ))}
      </SimpleGrid>

      <ToolbarHint
        density={density}
        onPick={(next) => {
          setDensity(next);
          markAnswered();
        }}
      />
    </VStack>
  );
};

interface DensityCardProps {
  option: DensityOption;
  active: boolean;
  onSelect: () => void;
}

const DensityCard: React.FC<DensityCardProps> = ({
  option,
  active,
  onSelect,
}) => (
  <Box
    as="button"
    type="button"
    onClick={onSelect}
    aria-pressed={active}
    textAlign="left"
    padding={4}
    borderRadius="lg"
    borderWidth="1px"
    borderColor={active ? `${option.accent}.solid` : "border.muted"}
    background={active ? `${option.accent}.subtle` : "bg.panel/40"}
    transition="all 0.15s ease"
    cursor="pointer"
    _hover={
      active
        ? undefined
        : {
            borderColor: `${option.accent}.muted`,
            background: "bg.panel/70",
            transform: "translateY(-1px)",
          }
    }
  >
    <VStack align="stretch" gap={3}>
      <HStack justify="space-between" align="center">
        <HStack gap={2.5}>
          <Flex
            width={8}
            height={8}
            borderRadius="md"
            bg={`${option.accent}.subtle`}
            color={`${option.accent}.fg`}
            borderWidth={active ? "1px" : "0"}
            borderColor={`${option.accent}.muted`}
            align="center"
            justify="center"
          >
            <Icon boxSize={4}>{option.icon}</Icon>
          </Flex>
          <Text textStyle="sm" fontWeight="semibold">
            {option.label}
          </Text>
        </HStack>
        {active && (
          <HStack
            gap={1}
            paddingX={1.5}
            paddingY={0.5}
            borderRadius="full"
            bg={`${option.accent}.solid`}
            color={`${option.accent}.contrast`}
          >
            <Icon boxSize={2.5}>
              <Check />
            </Icon>
            <Text textStyle="2xs" fontWeight="600">
              Selected
            </Text>
          </HStack>
        )}
      </HStack>

      <DensityPreview option={option} />

      <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
        {option.blurb}
      </Text>
    </VStack>
  </Box>
);

const DensityPreview: React.FC<{ option: DensityOption }> = ({ option }) => (
  <Box
    borderRadius="md"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.surface"
    paddingX={3}
    paddingY={3}
    height="140px"
    overflow="hidden"
  >
    <VStack align="stretch" gap={`${option.rowGap}px`}>
      {Array.from({ length: option.rowCount }).map((_, i) => (
        <HStack key={i} gap={2}>
          <Box
            height={`${option.rowHeight}px`}
            width="22%"
            borderRadius="sm"
            bg="border.emphasized"
            opacity={0.7}
          />
          <Box
            height={`${option.rowHeight}px`}
            flex={1}
            borderRadius="sm"
            bg="border.muted"
          />
          <Box
            height={`${option.rowHeight}px`}
            width="14%"
            borderRadius="sm"
            bg="border.muted"
          />
        </HStack>
      ))}
    </VStack>
  </Box>
);

interface ToolbarHintProps {
  density: Density;
  onPick: (next: Density) => void;
}

/**
 * Visual mnemonic: shows the *real* toolbar location of the density toggle on
 * the left (mini illustration) and a 5×-scale interactive version on the right
 * so the user can rehearse the action before they go hunting for it.
 */
const ToolbarHint: React.FC<ToolbarHintProps> = ({ density, onPick }) => (
  <HStack
    gap={6}
    align="center"
    paddingX={5}
    paddingY={5}
    borderRadius="lg"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.panel/40"
  >
    <ToolbarMockup density={density} />
    <Icon boxSize={4} color="fg.subtle" flexShrink={0}>
      <ArrowRight />
    </Icon>
    <BigDensityToggle current={density} onPick={onPick} />
    <VStack align="stretch" gap={1} flex={1}>
      <Text textStyle="sm" fontWeight="semibold">
        It lives above the table
      </Text>
      <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
        Tap either icon any time. Your choice is saved on this device, so every
        lens and every visit comes back the same way.
      </Text>
    </VStack>
  </HStack>
);

/**
 * Tiny illustration of the trace toolbar with the density buttons drawn at
 * their actual size, so the user can spot the real thing in the live app.
 */
const ToolbarMockup: React.FC<{ density: Density }> = ({ density }) => (
  <Box
    flexShrink={0}
    width="180px"
    borderRadius="md"
    borderWidth="1px"
    borderColor="border.muted"
    overflow="hidden"
    background="bg.surface"
  >
    <HStack
      gap={1.5}
      paddingX={2}
      paddingY={1.5}
      borderBottomWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
      justify="space-between"
    >
      <HStack gap={1}>
        <Box width="28px" height="6px" borderRadius="sm" bg="border.muted" />
        <Box width="20px" height="6px" borderRadius="sm" bg="border.muted" />
      </HStack>
      <ToolbarTinyToggle current={density} />
    </HStack>
    <VStack align="stretch" gap={1} paddingX={2} paddingY={2}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Box
          key={i}
          height="5px"
          width={`${60 + ((i * 17) % 35)}%`}
          borderRadius="sm"
          bg="border.muted"
        />
      ))}
    </VStack>
  </Box>
);

const ToolbarTinyToggle: React.FC<{ current: Density }> = ({ current }) => (
  <HStack gap={0}>
    <Flex
      width="14px"
      height="14px"
      borderRadius="sm"
      borderTopRightRadius={0}
      borderBottomRightRadius={0}
      borderWidth="1px"
      borderColor="border.muted"
      bg={current === "compact" ? "blue.subtle" : "bg.surface"}
      color={current === "compact" ? "blue.fg" : "fg.muted"}
      align="center"
      justify="center"
      transition="all 0.18s ease"
    >
      <Icon boxSize="8px">
        <AArrowDown />
      </Icon>
    </Flex>
    <Flex
      width="14px"
      height="14px"
      borderRadius="sm"
      borderTopLeftRadius={0}
      borderBottomLeftRadius={0}
      borderWidth="1px"
      borderColor="border.muted"
      bg={current === "comfortable" ? "blue.subtle" : "bg.surface"}
      color={current === "comfortable" ? "blue.fg" : "fg.muted"}
      align="center"
      justify="center"
      marginLeft="-1px"
      transition="all 0.18s ease"
    >
      <Icon boxSize="8px">
        <AArrowUp />
      </Icon>
    </Flex>
  </HStack>
);

interface BigDensityToggleProps {
  current: Density;
  onPick: (next: Density) => void;
}

const BigDensityToggle: React.FC<BigDensityToggleProps> = ({
  current,
  onPick,
}) => (
  <HStack gap={0} flexShrink={0} position="relative">
    <BigToggleButton
      icon={<AArrowDown />}
      label="Compact"
      active={current === "compact"}
      first
      onClick={() => onPick("compact")}
    />
    <BigToggleButton
      icon={<AArrowUp />}
      label="Comfortable"
      active={current === "comfortable"}
      onClick={() => onPick("comfortable")}
    />
  </HStack>
);

interface BigToggleButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  first?: boolean;
  onClick: () => void;
}

const BigToggleButton: React.FC<BigToggleButtonProps> = ({
  icon,
  label,
  active,
  first,
  onClick,
}) => (
  <motion.button
    onClick={onClick}
    type="button"
    aria-label={label}
    aria-pressed={active}
    initial={false}
    animate={
      active
        ? {
            scale: [1, 1.06, 1],
            // inset shadows so the pulse stays inside the parent's
            // overflow:hidden bounds — no halo bleed out of the dialog.
            boxShadow: [
              "inset 0 0 0 0 var(--chakra-colors-blue-muted)",
              "inset 0 0 0 6px var(--chakra-colors-blue-muted)",
              "inset 0 0 0 0 var(--chakra-colors-blue-muted)",
            ],
          }
        : { scale: 1, boxShadow: "inset 0 0 0 0 rgba(0,0,0,0)" }
    }
    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    style={{
      width: "120px",
      height: "120px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: active
        ? "var(--chakra-colors-blue-solid)"
        : "var(--chakra-colors-border-muted)",
      background: active
        ? "var(--chakra-colors-blue-subtle)"
        : "var(--chakra-colors-bg-surface)",
      color: active
        ? "var(--chakra-colors-blue-fg)"
        : "var(--chakra-colors-fg-muted)",
      borderTopLeftRadius: first ? "var(--chakra-radii-lg)" : 0,
      borderBottomLeftRadius: first ? "var(--chakra-radii-lg)" : 0,
      borderTopRightRadius: first ? 0 : "var(--chakra-radii-lg)",
      borderBottomRightRadius: first ? 0 : "var(--chakra-radii-lg)",
      marginLeft: first ? 0 : "-1px",
      cursor: "pointer",
    }}
  >
    <motion.div
      animate={
        active ? { scale: 1.12, opacity: 1 } : { scale: 1, opacity: 0.8 }
      }
      transition={{ duration: 0.3 }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon boxSize={12}>{icon}</Icon>
    </motion.div>
  </motion.button>
);
