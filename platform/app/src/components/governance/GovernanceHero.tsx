import { HStack, Text, VStack } from "@chakra-ui/react";
import { SourceTypeIconGlyph } from "@ee/governance/dashboard/components/ingestionSourceCatalog";
import type { SourceType } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import type React from "react";
import { LuBot, LuPackageOpen, LuUsers } from "react-icons/lu";
import { AskChip } from "~/components/home/AskChip";
import { HeroAskField } from "~/components/home/HeroAskField";
import { HeroLeadPill } from "~/components/home/HeroLeadPill";
import { WelcomeHeader } from "~/components/home/WelcomeHeader";
import { Menu } from "~/components/ui/menu";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { useRouter } from "~/utils/compat/next-router";

/**
 * The governance overview's opening, the same shape the project home opens
 * with: a greeting, one field, and the short ways in. The field is the
 * command palette mounted inline, the pill is the one action a governance
 * admin takes first (connect a vendor), and the chips under it are the three
 * things they add next — people, an agent, a tool.
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */

/**
 * The reading measure the whole overview is set to: the field, the ways in
 * under it, and the two lists below all take this width and centre on it, so
 * the sections' outer edges land on the field's own. Exported for the page,
 * which wraps hero and sections in one column of it.
 */
export const HOME_MEASURE = "900px";

export const INVENTORY_SOURCES_HREF = "/governance/inventory?tab=sources";
export const PEOPLE_HREF = "/governance/people?tab=people";
export const ADD_AGENT_HREF = "/governance/agents?tab=agents&add=1";
/**
 * The inventory's bare address, which opens on the Catalog pane. Bare rather
 * than `?tab=catalog` because that page keeps its default tab out of the
 * address, and bare rather than the `?tab=anomaly-rules` this shortcut used to
 * carry: anomaly rules stopped being an inventory tab, so that address
 * degraded to this same pane and the shortcut delivered the tool catalog under
 * a rule's name.
 */
export const INVENTORY_CATALOG_HREF = "/governance/inventory";

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
 * The three ways in under the pill, in the order they are offered: add
 * someone, give them an agent, then register the tools they run. That is the
 * order a surface is set up in, rather than the order the pages sit in the
 * rail.
 *
 * Every href here that carries a `?tab=` must name a tab its page actually
 * has. A page degrades an unknown tab to its default pane rather than
 * refusing it, so a stale tab name is a silent wrong destination — which is
 * what the third chip was until it stopped naming a retired tab.
 */
const LEAD_CHIPS: ReadonlyArray<{
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}> = [
  {
    key: "people",
    label: "Add people",
    href: PEOPLE_HREF,
    icon: <LuUsers size={12} />,
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
    href: INVENTORY_CATALOG_HREF,
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

      <VStack align="center" gap={3} width="full" maxWidth={HOME_MEASURE}>
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
          prominent
          label="Add Source"
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
      </Menu.Content>
    </Menu.Root>
  );
}
