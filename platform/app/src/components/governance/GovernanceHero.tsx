import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { SourceTypeIconGlyph } from "@ee/governance/dashboard/components/ingestionSourceCatalog";
import type { SourceType } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { Building2 } from "lucide-react";
import type React from "react";
import { LuBot, LuPackageOpen, LuSettings2 } from "react-icons/lu";
import { AskChip } from "~/components/home/AskChip";
import { HeroAskField } from "~/components/home/HeroAskField";
import { HeroLeadPill } from "~/components/home/HeroLeadPill";
import { WelcomeHeader } from "~/components/home/WelcomeHeader";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { useRouter } from "~/utils/compat/next-router";

/**
 * The governance overview's opening, the same shape the project home opens
 * with: a greeting, one field, and the short ways in. The field is the
 * command palette mounted inline, the pill is the one action a governance
 * admin takes first (connect a vendor), and the chips under it are the things
 * they set up next — a department, an agent, a tool. The way through to the
 * whole source catalog is the last row of the pill's own menu, not a fourth
 * chip.
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */

/**
 * The field's reading measure, and the measure of the pill and chips that
 * hang off it.
 *
 * It is the SAME question in the same words as the project home's field, so
 * it is set to the same width: the two screens sit one click apart in the
 * rail, and a field that changed size between them read as two different
 * controls.
 *
 * Source of truth is `ASK_MEASURE` in `~/components/home/LangyHomeHero`,
 * where it is private to that module. Restated here rather than imported so
 * this hero does not pull the project home's hero in behind it; lifting the
 * one value into a module both can import is the standing follow-up.
 */
const ASK_MEASURE = "680px";

/**
 * The measure the overview PAGE is set to: the header row above the hero, the
 * hero's lit ground, and the two lists below it.
 *
 * Wider than the field on purpose. The lists are a two-column grid whose rows
 * each carry a badge, a headline and a date, and at the field's own width
 * those columns stop being scannable. So the lists no longer begin and end on
 * the field's edges — the field is narrower, centred inside them. Exported
 * for the page, which wraps the whole column in it.
 */
export const HOME_MEASURE = "900px";

export const INVENTORY_SOURCES_HREF = "/governance/inventory?tab=sources";
export const ADD_DEPARTMENT_HREF = "/governance/people?tab=departments&add=1";
export const ADD_AGENT_HREF = "/governance/agents?tab=agents&add=1";
export const ADD_TOOL_HREF = "/governance/inventory?tab=catalog&add=1";

/**
 * The vendors the pill leads with, in the order the menu offers them. Each
 * hands the inventory's Sources tab a source type to open its add flow on,
 * through the `?add=` deep link that page already honours.
 */
export const LEAD_SOURCE_VENDORS: ReadonlyArray<{
  sourceType: SourceType;
  label: string;
}> = [
  { sourceType: "anthropic_admin", label: "Anthropic" },
  { sourceType: "openai_admin", label: "OpenAI" },
  { sourceType: "copilot_studio_dataverse", label: "Microsoft Copilot" },
];

export const addSourceHref = (sourceType: SourceType) =>
  `${INVENTORY_SOURCES_HREF}&add=${sourceType}`;

/**
 * The ways in under the pill: the order a surface is set up in — the group
 * people belong to, the agents that group runs, then the tools those agents
 * reach. Every one of them ADDS something, which is why they read as one row
 * of three rather than as a list with an odd one on the end.
 *
 * Configuring sources is not among them. It configures rather than adds, and
 * it belongs to the source pill above: it is the answer to "my vendor is not
 * one of the three in this menu", so it is the last row of that menu (see
 * `AddSourcePill`) the way the model picker keeps "Configure available
 * models" at the foot of its own list.
 *
 * Every href here that carries a `?tab=` must name a tab its page actually
 * has, and every `&add=1` must name a pane that opens something on arrival. A
 * page degrades an unknown tab to its default pane rather than refusing it,
 * and ignores an `?add=` the pane does not honour, so either mistake is a
 * silent wrong destination — which is what the first and third chips were
 * until they named a pane that opens a drawer.
 */
const LEAD_CHIPS: ReadonlyArray<{
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}> = [
  {
    key: "department",
    label: "Add department",
    href: ADD_DEPARTMENT_HREF,
    icon: <Building2 size={12} />,
  },
  {
    key: "agent",
    label: "Add agent",
    href: ADD_AGENT_HREF,
    icon: <LuBot size={12} />,
  },
  {
    key: "tool",
    label: "Add tool",
    href: ADD_TOOL_HREF,
    icon: <LuPackageOpen size={12} />,
  },
];

export function GovernanceHero({
  canManageSources,
}: {
  /** Holds `ingestionSources:manage`; without it the pill is not offered. */
  canManageSources: boolean;
}) {
  const canAsk = useCanAskLangy();

  return (
    <VStack align="center" gap={{ base: 5, md: 6 }} width="full">
      <VStack align="center" gap={1.5}>
        <WelcomeHeader />
        <Text fontSize="sm" color="fg.muted" textAlign="center">
          Every AI tool, agent, licence and dollar across the organization.
        </Text>
      </VStack>

      <VStack align="center" gap={3} width="full" maxWidth={ASK_MEASURE}>
        <HeroAskField
          placeholder={
            canAsk
              ? "Ask Langy, search, or jump to anything"
              : "Search, or jump to anything"
          }
        />

        <VStack width="full" gap={2.5} align="center">
          {canManageSources ? <AddSourcePill /> : null}
          <HStack gap={2} flexWrap="wrap" justify="center">
            {LEAD_CHIPS.map((chip) => (
              <AskChip
                key={chip.key}
                icon={chip.icon}
                label={chip.label}
                href={chip.href}
              />
            ))}
          </HStack>
        </VStack>
      </VStack>
    </VStack>
  );
}

/**
 * The lead action: connect a vendor. The three vendors a governance admin
 * arrives with are named up front, each opening the inventory's Sources tab
 * on that vendor's add flow. The rest of the catalog is not repeated here —
 * the Sources tab's own Add source menu is the full list, and a hero that
 * offered both would be asking the reader to choose between two menus.
 *
 * "Configure sources" is the last row of this menu, under a separator, and is
 * how a reader whose vendor is not one of these three reaches that list. It
 * is the shape `ModelSelector` and `LangyModelPill` both use for "Configure
 * available models": a full-width row at the foot of the open list, ruled off
 * from the options above it, carrying a settings glyph and plain muted text
 * rather than a bold or accented label.
 *
 * It is a `Menu.Item` where the model picker uses a bare control in a
 * `Select`/`Combobox` footer, because this list is a menu: an element that is
 * not an item inside one is out of arrow-key reach. It renders as an anchor,
 * so the address survives a right-click the way it did while this was a chip.
 *
 * OUTLINE, NOT FILLED. Everything in this section that creates something is
 * an outline control, so the one on the overview cannot be the exception —
 * the filled orange treatment (`prominent`) would make this the loudest
 * create button in a section where every other one is quiet. The project
 * home still leads with the filled pill, which is why that presentation stays
 * on `HeroLeadPill`.
 *
 * It still reads as the main way in, because the hierarchy here is not
 * colour: the pill sits on a raised muted ground with a stronger border and a
 * shadow, and it carries three vendor tiles and a caret, against chips that
 * are flat, unshadowed and hold one glyph each.
 *
 * Only drawn for a reader holding `ingestionSources:manage`, because the
 * inventory drops an `?add=` it arrives without that grant: an ungated pill
 * would be a door that opens onto nothing.
 */
function AddSourcePill() {
  const router = useRouter();
  return (
    <Menu.Root positioning={{ placement: "bottom", gutter: 6 }}>
      <Menu.Trigger asChild>
        <HeroLeadPill
          label="Add source"
          glyphs={LEAD_SOURCE_VENDORS.map((vendor) => ({
            key: vendor.sourceType,
            icon: (
              <SourceTypeIconGlyph sourceType={vendor.sourceType} size="10px" />
            ),
          }))}
        />
      </Menu.Trigger>
      <Menu.Content minWidth="240px" padding={1}>
        {LEAD_SOURCE_VENDORS.map((vendor) => (
          <Menu.Item
            key={vendor.sourceType}
            value={vendor.sourceType}
            paddingY={2}
            onClick={() => void router.push(addSourceHref(vendor.sourceType))}
          >
            <HStack gap={2.5}>
              <SourceTypeIconGlyph sourceType={vendor.sourceType} size="14px" />
              <Text textStyle="xs" fontWeight="medium">
                {vendor.label}
              </Text>
            </HStack>
          </Menu.Item>
        ))}

        {/* Cancels `Menu.Content`'s own padding so the rule runs the full
            width of the menu, the way the model picker's footer rule runs the
            full width of its list. */}
        <Box marginX={-1} marginY={1}>
          <Menu.Separator />
        </Box>
        <Menu.Item value="configure-sources" paddingY={2} asChild>
          <Link
            href={INVENTORY_SOURCES_HREF}
            display="flex"
            alignItems="center"
            gap={2.5}
            width="full"
            color="fg.muted"
            _hover={{ textDecoration: "none" }}
          >
            <LuSettings2 size={14} />
            <Text textStyle="xs" fontWeight="500">
              Configure sources
            </Text>
          </Link>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
