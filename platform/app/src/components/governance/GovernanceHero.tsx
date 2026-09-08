import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { SourceTypeIconGlyph } from "@ee/governance/dashboard/components/ingestionSourceCatalog";
import type { SourceType } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { LuLayers, LuTriangleAlert, LuUsers } from "react-icons/lu";
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
 * admin takes first (connect a vendor), and the chips are the next two.
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */

/** The field's reading measure, shared with the home so the two agree. */
const ASK_MEASURE = "680px";

export const INVENTORY_SOURCES_HREF = "/governance/inventory?tab=sources";
export const INVENTORY_ANOMALY_RULES_HREF =
  "/governance/inventory?tab=anomaly-rules";
export const PEOPLE_HREF = "/governance/people";

/**
 * The vendors the pill leads with, in the order the menu offers them. Each
 * hands the inventory's Sources tab a source type to open its add flow on.
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
            <AskChip
              icon={<LuTriangleAlert size={12} />}
              label="Add an anomaly rule"
              href={INVENTORY_ANOMALY_RULES_HREF}
            />
            <AskChip
              icon={<LuUsers size={12} />}
              label="Add people"
              href={PEOPLE_HREF}
            />
          </HStack>
        </VStack>
      </VStack>
    </VStack>
  );
}

/**
 * The lead action: connect a vendor. Three vendors up front, each opening
 * the inventory on that vendor's add flow, and the full list behind a
 * quieter fourth item for the reader whose vendor is not one of the three.
 */
function AddSourcePill() {
  const router = useRouter();
  return (
    <Menu.Root positioning={{ placement: "bottom", gutter: 6 }}>
      <Menu.Trigger asChild>
        <HeroLeadPill
          prominent
          label="Add an ingestion source"
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
        <Menu.Separator />
        <Menu.Item
          value="all-sources"
          paddingY={2}
          onClick={() => void router.push(INVENTORY_SOURCES_HREF)}
        >
          <HStack gap={2.5} color="fg.muted">
            <Box display="grid">
              <LuLayers size={13} />
            </Box>
            <Text textStyle="xs">All sources…</Text>
          </HStack>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
