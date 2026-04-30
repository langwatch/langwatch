import {
  Box,
  chakra,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowRight, X } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import { AiCallout } from "./_components";
import type { WelcomeStepProps } from "./steps";

interface FacetSeed {
  label: string;
  count: number;
  palette: string;
  selected: boolean;
}

const FACET_SEEDS: readonly FacetSeed[] = [
  { label: "claude-sonnet-4", count: 1284, palette: "purple", selected: true },
  { label: "gpt-5-mini", count: 902, palette: "green", selected: true },
  { label: "gpt-4o", count: 187, palette: "green", selected: false },
  { label: "haiku-4-5", count: 64, palette: "purple", selected: false },
];

const FACET_MAX = Math.max(...FACET_SEEDS.map((f) => f.count));

interface ExtraChipSeed {
  id: string;
  field: string;
  value: string;
  palette: "blue" | "red" | "purple";
}

const EXTRA_CHIP_SEEDS: readonly ExtraChipSeed[] = [
  { id: "duration", field: "duration", value: ">5s", palette: "blue" },
  { id: "error", field: "error", value: "true", palette: "blue" },
];

export const FilteringStep: React.FC<WelcomeStepProps> = () => {
  const initialSelected = useMemo(
    () => new Set(FACET_SEEDS.filter((f) => f.selected).map((f) => f.label)),
    [],
  );
  const initialExtras = useMemo(() => EXTRA_CHIP_SEEDS.map((c) => c.id), []);

  const [selectedFacets, setSelectedFacets] =
    useState<Set<string>>(initialSelected);
  const [extraChipIds, setExtraChipIds] = useState<Set<string>>(
    () => new Set(initialExtras),
  );

  const toggleFacet = useCallback((label: string) => {
    setSelectedFacets((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const removeExtra = useCallback((id: string) => {
    setExtraChipIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSelectedFacets(new Set(initialSelected));
    setExtraChipIds(new Set(initialExtras));
  }, [initialSelected, initialExtras]);

  const isModified =
    selectedFacets.size !== initialSelected.size ||
    [...selectedFacets].some((s) => !initialSelected.has(s)) ||
    extraChipIds.size !== initialExtras.length;

  return (
    <VStack align="stretch" gap={5}>
      <FilterFlowDiagram
        selectedFacets={selectedFacets}
        extraChipIds={extraChipIds}
        onToggleFacet={toggleFacet}
        onRemoveExtra={removeExtra}
        isModified={isModified}
        onReset={reset}
      />

      <VStack align="stretch" gap={2}>
        <Text textStyle="sm" color="fg.muted" lineHeight="1.55">
          Filters and facets are the same thing.{" "}
          <Text as="span" color="fg" fontWeight="semibold">
            The sidebar is the easy way in.
          </Text>{" "}
          Tick boxes to narrow the list — under the hood that becomes a chip in
          the search bar. The bar lets you go further: combine fields, mix{" "}
          <ChipMono>AND</ChipMono> / <ChipMono>OR</ChipMono>, compare numbers,
          match patterns. Save any combination as a lens.
        </Text>
        <Text textStyle="2xs" color="fg.subtle">
          Try it: click a model on the left or hover the chips on the right.
          Nothing happens to your real traces — this is a sandbox.
        </Text>
      </VStack>

      <AiFilterCallout />
    </VStack>
  );
};

interface FlowProps {
  selectedFacets: Set<string>;
  extraChipIds: Set<string>;
  onToggleFacet: (label: string) => void;
  onRemoveExtra: (id: string) => void;
  isModified: boolean;
  onReset: () => void;
}

const FilterFlowDiagram: React.FC<FlowProps> = (props) => (
  <Box
    borderRadius="lg"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.panel/40"
    overflow="hidden"
  >
    <HStack gap={0} align="stretch" minHeight="220px">
      <FacetPanel
        selectedFacets={props.selectedFacets}
        onToggleFacet={props.onToggleFacet}
      />
      <ArrowColumn />
      <ChipsPanel
        selectedFacets={props.selectedFacets}
        extraChipIds={props.extraChipIds}
        onToggleFacet={props.onToggleFacet}
        onRemoveExtra={props.onRemoveExtra}
        isModified={props.isModified}
        onReset={props.onReset}
      />
    </HStack>
  </Box>
);

const FacetPanel: React.FC<{
  selectedFacets: Set<string>;
  onToggleFacet: (label: string) => void;
}> = ({ selectedFacets, onToggleFacet }) => (
  <VStack
    align="stretch"
    gap={2}
    width="46%"
    paddingX={3.5}
    paddingY={3}
    bg="bg.subtle"
    borderRightWidth="1px"
    borderColor="border.muted"
  >
    <HStack gap={2} justify="space-between">
      <Text
        textStyle="2xs"
        color="fg.subtle"
        textTransform="uppercase"
        letterSpacing="0.08em"
        fontWeight="bold"
      >
        Facets
      </Text>
      <Text textStyle="2xs" color="fg.subtle" fontWeight="medium">
        model
      </Text>
    </HStack>
    <VStack align="stretch" gap={0.5}>
      {FACET_SEEDS.map((facet) => (
        <FacetRowMock
          key={facet.label}
          label={facet.label}
          count={facet.count}
          palette={facet.palette}
          selected={selectedFacets.has(facet.label)}
          onToggle={() => onToggleFacet(facet.label)}
        />
      ))}
    </VStack>
  </VStack>
);

interface FacetRowMockProps {
  label: string;
  count: number;
  palette: string;
  selected: boolean;
  onToggle: () => void;
}

const FacetRowMock: React.FC<FacetRowMockProps> = ({
  label,
  count,
  palette,
  selected,
  onToggle,
}) => {
  const fillPct = Math.max((count / FACET_MAX) * 100, count > 0 ? 4 : 0);
  const subtleBg = `${palette}.subtle`;
  const solidBar = `${palette}.solid`;

  return (
    <chakra.button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      aria-label={`${label} — ${selected ? "selected" : "click to select"}`}
      position="relative"
      width="full"
      paddingY={1}
      paddingLeft={1.5}
      paddingRight={2}
      borderRadius="sm"
      overflow="hidden"
      background={selected ? subtleBg : "transparent"}
      transition="background 120ms ease"
      cursor="pointer"
      textAlign="left"
      _hover={{
        background: selected ? subtleBg : "bg.muted",
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <Box
        position="absolute"
        bottom={0}
        left={0}
        width={`${fillPct}%`}
        height="2px"
        bg={solidBar}
        opacity={0.55}
        pointerEvents="none"
      />
      {selected ? (
        <Box
          position="absolute"
          top={0}
          right={0}
          bottom={0}
          width="2px"
          bg={solidBar}
          pointerEvents="none"
        />
      ) : null}
      <HStack gap={1.5} position="relative" zIndex={1}>
        <Box
          width="8px"
          height="8px"
          borderRadius="full"
          bg={solidBar}
          flexShrink={0}
          opacity={selected ? 1 : 0.55}
          transition="opacity 120ms ease"
        />
        <Text
          textStyle="2xs"
          flex={1}
          truncate
          color={selected ? "fg" : "fg.muted"}
          fontWeight={selected ? "600" : "500"}
        >
          {label}
        </Text>
        <Text
          textStyle="2xs"
          fontFamily="mono"
          color="fg.subtle"
          fontWeight={selected ? "600" : "400"}
        >
          {count.toLocaleString()}
        </Text>
      </HStack>
    </chakra.button>
  );
};

const ArrowColumn: React.FC = () => (
  <Flex
    width="36px"
    align="center"
    justify="center"
    flexShrink={0}
    bg="bg.panel"
    color="fg.subtle"
  >
    <Icon boxSize={4}>
      <ArrowRight />
    </Icon>
  </Flex>
);

interface RenderedChip {
  key: string;
  field: string;
  value: string;
  palette: "blue" | "red" | "purple" | "green";
  onRemove: () => void;
}

const ChipsPanel: React.FC<{
  selectedFacets: Set<string>;
  extraChipIds: Set<string>;
  onToggleFacet: (label: string) => void;
  onRemoveExtra: (id: string) => void;
  isModified: boolean;
  onReset: () => void;
}> = ({
  selectedFacets,
  extraChipIds,
  onToggleFacet,
  onRemoveExtra,
  isModified,
  onReset,
}) => {
  const chips: RenderedChip[] = useMemo(() => {
    const out: RenderedChip[] = [];
    for (const facet of FACET_SEEDS) {
      if (!selectedFacets.has(facet.label)) continue;
      out.push({
        key: `model:${facet.label}`,
        field: "model",
        value: facet.label,
        palette: facet.palette === "purple" ? "purple" : "green",
        onRemove: () => onToggleFacet(facet.label),
      });
    }
    for (const seed of EXTRA_CHIP_SEEDS) {
      if (!extraChipIds.has(seed.id)) continue;
      out.push({
        key: `extra:${seed.id}`,
        field: seed.field,
        value: seed.value,
        palette: seed.palette,
        onRemove: () => onRemoveExtra(seed.id),
      });
    }
    return out;
  }, [selectedFacets, extraChipIds, onToggleFacet, onRemoveExtra]);

  return (
    <VStack
      align="stretch"
      gap={2.5}
      flex={1}
      paddingX={3.5}
      paddingY={3}
      bg="bg.panel"
    >
      <HStack gap={2} justify="space-between">
        <Text
          textStyle="2xs"
          color="fg.subtle"
          textTransform="uppercase"
          letterSpacing="0.08em"
          fontWeight="bold"
        >
          Filter expression
        </Text>
        {isModified ? (
          <Text
            as="button"
            textStyle="2xs"
            color="blue.fg"
            fontWeight="medium"
            cursor="pointer"
            _hover={{ textDecoration: "underline" }}
            onClick={onReset}
          >
            Reset
          </Text>
        ) : null}
      </HStack>
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        paddingX={2}
        paddingY={1.5}
        bg="bg.surface"
        minHeight="44px"
        fontFamily="mono"
      >
        {chips.length === 0 ? (
          <Text textStyle="2xs" color="fg.subtle" fontStyle="italic">
            No filters — every trace will show.
          </Text>
        ) : (
          <HStack gap={0} flexWrap="wrap" rowGap={1}>
            {chips.map((chip, i) => {
              const prev = chips[i - 1];
              const sameFieldAsPrev = prev && prev.field === chip.field;
              const connector = !prev ? null : sameFieldAsPrev ? "OR" : "AND";
              return (
                <HStack key={chip.key} gap={0} alignItems="center">
                  {connector ? <KeywordToken kind={connector} /> : null}
                  <FilterChip
                    field={chip.field}
                    value={chip.value}
                    palette={chip.palette}
                    onRemove={chip.onRemove}
                  />
                </HStack>
              );
            })}
          </HStack>
        )}
      </Box>
      <Text textStyle="2xs" color="fg.subtle" lineHeight="1.5">
        Sidebar ticks become chips. The next two were typed straight into the
        search bar — same engine, more reach.
      </Text>
    </VStack>
  );
};

interface FilterChipProps {
  field: string;
  value: string;
  palette: "blue" | "red" | "purple" | "green";
  onRemove: () => void;
}

// Mirrors editorStyles `.filter-token` / `.filter-token-delete`. The X
// always works in this demo — every chip in the bar represents a live
// filter the user can drop.
const FilterChip: React.FC<FilterChipProps> = ({
  field,
  value,
  palette,
  onRemove,
}) => (
  <Box
    position="relative"
    display="inline-flex"
    alignItems="center"
    marginX="1px"
    paddingLeft={1}
    paddingRight={3.5}
    paddingY={0.5}
    borderRadius="4px"
    borderWidth="1px"
    borderColor={`${palette}.muted`}
    bg={`${palette}.subtle`}
    color="fg"
    role="group"
  >
    <Text textStyle="2xs" fontFamily="mono">
      {field}
      <Text as="span" color="fg.subtle">
        :
      </Text>
      {value}
    </Text>
    <chakra.button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${field}:${value}`}
      position="absolute"
      top={0}
      right={0}
      bottom={0}
      width="14px"
      display="flex"
      alignItems="center"
      justifyContent="center"
      color="fg.muted"
      borderTopRightRadius="3px"
      borderBottomRightRadius="3px"
      opacity={0}
      transition="opacity 80ms ease-out, background 80ms ease-out"
      _groupHover={{ opacity: 1 }}
      _hover={{ background: "red.subtle", color: "red.fg", opacity: 1 }}
      cursor="pointer"
      userSelect="none"
    >
      <Icon boxSize="8px">
        <X />
      </Icon>
    </chakra.button>
  </Box>
);

// Mirrors the `.filter-keyword` / `.filter-keyword-or` styling from
// editorStyles: muted, semibold, tracking-tight, with OR tinted orange.
const KeywordToken: React.FC<{ kind: "AND" | "OR" }> = ({ kind }) => (
  <Text
    textStyle="2xs"
    fontFamily="mono"
    fontWeight="semibold"
    letterSpacing="0.02em"
    color={kind === "OR" ? "orange.fg" : "fg.muted"}
    paddingX={1.5}
  >
    {kind}
  </Text>
);

const ChipMono: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    as="span"
    display="inline-flex"
    paddingX={1}
    borderRadius="sm"
    bg="bg.panel"
    borderWidth="1px"
    borderColor="border.muted"
    fontFamily="mono"
    textStyle="2xs"
    fontWeight="semibold"
    color="fg"
    verticalAlign="baseline"
  >
    {children}
  </Box>
);

const AiFilterCallout: React.FC = () => (
  <AiCallout>
    <Text textStyle="xs" fontWeight="semibold" color="purple.fg">
      Don&apos;t know the field name? Just ask.
    </Text>
    <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
      The sparkles in the search bar take plain English — &quot;
      <i>slow checkout calls from EU users yesterday</i>&quot; — and turn it
      into a filter expression you can tweak, then save as a lens.
    </Text>
  </AiCallout>
);
