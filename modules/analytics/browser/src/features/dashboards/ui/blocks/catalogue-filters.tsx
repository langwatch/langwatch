/**
 * The catalogue's chips, shared by the templates finder and the "Add a widget" picker: category
 * chips in their trunk's colour, and agent-type chips. Each row picks one value; clicking the
 * picked chip again clears it. With them, the finder's plain search; the picker has the ask bar.
 */

import { Box, Button, HStack, Text } from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { Activity, BadgeCheck, DollarSign, type LucideIcon, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import {
  AGENT_KIND_CHIP_LABELS,
  AGENT_KINDS,
  type AgentKind,
  TRUNKS,
  type Trunk,
} from "../../catalogue/index.ts";
import type { TrunkCounts } from "../../model/catalogue-filter.ts";

/** One design-system palette per trunk: its chip, its icon and its section headings. */
export const TRUNK_PALETTES: Readonly<Record<Trunk, string>> = {
  Profit: "green",
  Grow: "blue",
  Protect: "orange",
  Trust: "purple",
};

export const TRUNK_ICONS: Readonly<Record<Trunk, LucideIcon>> = {
  Profit: DollarSign,
  Grow: Activity,
  Protect: ShieldCheck,
  Trust: BadgeCheck,
};

/** The agent types a chip row offers; coding-agent boards and widgets live elsewhere. */
const CHIP_KINDS = AGENT_KINDS.filter((kind) => kind !== "coding");

/** The finder's plain, centred search box. */
export function CatalogueSearch({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  /** Also the box's accessible name. */
  placeholder: string;
  onChange: (next: string) => void;
}) {
  return (
    // A grid stretches the inline search group, so the whole placeholder shows.
    <Box display="grid" width="full" maxWidth="640px">
      <SearchInput
        aria-label={placeholder}
        placeholder={placeholder}
        height="40px"
        borderRadius="full"
        fontSize="14px"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Box>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <HStack
      as="fieldset"
      aria-label={label}
      margin={0}
      padding={0}
      border="none"
      minWidth={0}
      gap={2}
      wrap="wrap"
      justify="center"
    >
      {children}
    </HStack>
  );
}

/** A trunk chip wears its palette; any other chip is neutral and turns dark when picked. */
function chipLook({ isPicked, hasPalette }: { isPicked: boolean; hasPalette: boolean }) {
  if (hasPalette) {
    return isPicked
      ? { background: "colorPalette.solid", color: "colorPalette.contrast" }
      : { background: "colorPalette.subtle", color: "colorPalette.fg" };
  }
  return isPicked
    ? { background: "fg", color: "bg" }
    : { background: "bg.muted", color: "fg.muted" };
}

/** One chip: its words, its count, and the colours it shows resting and picked. */
function Chip({
  label,
  count,
  isPicked,
  palette,
  icon: Icon,
  onClick,
}: {
  label: string;
  count: number;
  isPicked: boolean;
  /** A trunk's palette; without one the chip is neutral and turns dark when picked. */
  palette?: string;
  icon?: LucideIcon;
  onClick: () => void;
}) {
  const look = chipLook({ isPicked, hasPalette: palette !== void 0 });
  return (
    <Button
      variant="plain"
      height="30px"
      gap={1.5}
      paddingX={3}
      borderRadius="full"
      fontSize="12.5px"
      fontWeight="medium"
      colorPalette={palette}
      {...look}
      _hover={isPicked ? void 0 : { filter: "brightness(0.96)", color: palette ? void 0 : "fg" }}
      aria-pressed={isPicked}
      onClick={onClick}
    >
      {Icon && <Icon size={12} strokeWidth={2.2} aria-hidden />}
      {label}
      <Text as="span" opacity={0.7} fontVariantNumeric="tabular-nums">
        {count}
      </Text>
    </Button>
  );
}

/** "All" and one chip per trunk with something in it, each in its own colour. */
export function TrunkChips({
  picked,
  counts,
  onPick,
}: {
  picked: Trunk | undefined;
  counts: TrunkCounts;
  onPick: (trunk: Trunk | undefined) => void;
}) {
  return (
    <ChipRow label="Categories">
      <Chip
        label="All"
        count={counts.all}
        isPicked={picked === void 0}
        onClick={() => onPick(void 0)}
      />
      {TRUNKS.flatMap((trunk) => {
        const isPicked = picked === trunk;
        // A chip offering nothing is noise; a picked one stays so it can be cleared.
        if (counts.byTrunk[trunk] === 0 && !isPicked) return [];
        return [
          <Chip
            key={trunk}
            label={trunk}
            count={counts.byTrunk[trunk]}
            isPicked={isPicked}
            palette={TRUNK_PALETTES[trunk]}
            icon={TRUNK_ICONS[trunk]}
            onClick={() => onPick(isPicked ? void 0 : trunk)}
          />,
        ];
      })}
    </ChipRow>
  );
}

/** One chip per agent type that has something made for it; each shows only that type's items. */
export function AgentKindChips({
  picked,
  countOf,
  onPick,
}: {
  picked: AgentKind | undefined;
  countOf: (kind: AgentKind) => number;
  onPick: (kind: AgentKind | undefined) => void;
}) {
  return (
    <ChipRow label="Agent types">
      {CHIP_KINDS.flatMap((kind) => {
        const count = countOf(kind);
        const isPicked = picked === kind;
        if (count === 0 && !isPicked) return [];
        return [
          <Chip
            key={kind}
            label={AGENT_KIND_CHIP_LABELS[kind]}
            count={count}
            isPicked={isPicked}
            onClick={() => onPick(isPicked ? void 0 : kind)}
          />,
        ];
      })}
    </ChipRow>
  );
}
