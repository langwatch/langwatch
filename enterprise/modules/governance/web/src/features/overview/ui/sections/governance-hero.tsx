/**
 * The overview's opening: a greeting, the inline command palette, and the
 * short ways in. Ported from `.../governance/GovernanceHero.tsx` (main).
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@langwatch/design-system/menu";
import { Bot, Building2, PackageOpen, Settings2 } from "lucide-react";
import type React from "react";
import { useGovernanceRouter } from "../../../../behavior/governance-router.ts";
import { useGovernanceHost } from "../../../../model/governance-host.ts";
import { Link } from "../../../../ui/elements/governance-link.tsx";
import type { SourceType } from "../../../ingestion-sources/model/ingestion-source-catalog.ts";
import { SourceTypeIconGlyph } from "../../../ingestion-sources/ui/elements/source-type-icon-glyph.tsx";
import { AskChip } from "@langwatch/design-system/ask-chip";
import { GovernanceWelcomeHeader } from "../elements/governance-welcome-header.tsx";
import { HeroAskField } from "@langwatch/project-web/surfaces/hero-ask-field";
import { HeroLeadPill } from "@langwatch/design-system/hero-lead-pill";

/**
 * Same width as the project home's own ask field (`ASK_MEASURE` there),
 * restated rather than imported to avoid pulling that hero in behind it.
 */
const ASK_MEASURE = "680px";

/** The whole column's width: header, hero ground and the two lists below. */
export const HOME_MEASURE = "900px";

export const INVENTORY_SOURCES_HREF = "/governance/inventory?tab=sources";
export const ADD_DEPARTMENT_HREF = "/governance/people?tab=departments&add=1";
export const ADD_AGENT_HREF = "/governance/agents?add=1";
export const ADD_TOOL_HREF = "/governance/inventory?tab=catalog&add=1";

/** The vendors the "Add source" pill leads with, in menu order. */
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

/** The three quick-add chips: department, agent, tool — every one adds. */
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
    icon: <Bot size={12} />,
  },
  {
    key: "tool",
    label: "Add tool",
    href: ADD_TOOL_HREF,
    icon: <PackageOpen size={12} />,
  },
];

export function GovernanceHero({
  canManageSources,
}: {
  /** Holds `ingestionSources:manage`; without it the pill is not offered. */
  canManageSources: boolean;
}) {
  const canAsk = useGovernanceHost().hasPermission("langy:create");

  return (
    <VStack align="center" gap={{ base: 5, md: 6 }} width="full">
      <VStack align="center" gap={1.5}>
        <GovernanceWelcomeHeader />
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
 * The lead action: connect a vendor, or "Configure sources" for the rest.
 * Outline, not filled, like every create control here. Gated on
 * `ingestionSources:manage`.
 */
function AddSourcePill() {
  const router = useGovernanceRouter();
  return (
    <MenuRoot positioning={{ placement: "bottom", gutter: 6 }}>
      <MenuTrigger asChild>
        <HeroLeadPill
          label="Add source"
          glyphs={LEAD_SOURCE_VENDORS.map((vendor) => ({
            key: vendor.sourceType,
            icon: (
              <SourceTypeIconGlyph sourceType={vendor.sourceType} size="10px" />
            ),
          }))}
        />
      </MenuTrigger>
      <MenuContent minWidth="240px" padding={1}>
        {LEAD_SOURCE_VENDORS.map((vendor) => (
          <MenuItem
            key={vendor.sourceType}
            value={vendor.sourceType}
            paddingY={2}
            onClick={() => router.push(addSourceHref(vendor.sourceType))}
          >
            <HStack gap={2.5}>
              <SourceTypeIconGlyph sourceType={vendor.sourceType} size="14px" />
              <Text textStyle="xs" fontWeight="medium">
                {vendor.label}
              </Text>
            </HStack>
          </MenuItem>
        ))}

        {/* Cancels the content's own padding so the rule runs full width. */}
        <Box marginX={-1} marginY={1}>
          <MenuSeparator />
        </Box>
        <MenuItem value="configure-sources" paddingY={2} asChild>
          <Link
            href={INVENTORY_SOURCES_HREF}
            display="flex"
            alignItems="center"
            gap={2.5}
            width="full"
            color="fg.muted"
            _hover={{ textDecoration: "none" }}
          >
            <Settings2 size={14} />
            <Text textStyle="xs" fontWeight="500">
              Configure sources
            </Text>
          </Link>
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}
