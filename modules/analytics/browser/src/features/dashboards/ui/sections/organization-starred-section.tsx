/**
 * The "Starred dashboards" group, lent through `OrganizationStarredDashboardsToken` (§10.1):
 * the member's stars across the organization as plain links with no menu, the first 7 then
 * "All starred (N)", which opens the library. It folds and unfolds; nothing shows with no star.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { SidebarSection, SidebarSectionLabel } from "@langwatch/design-system/app-shell";
import { HStack, VStack } from "@langwatch/design-system/primitives";
import { ChevronDown, LayoutDashboard } from "lucide-react";
import { useState } from "react";

import { useOrganizationStars } from "../../behavior/use-organization-stars.ts";
import { ORGANIZATION_DASHBOARDS_PATH } from "../../model/boards.ts";
import { STARRED_SHOWN_MAX } from "../../model/organization-library.ts";
import { SidebarLinkRow } from "../blocks/sidebar-link-row.tsx";

const LABEL = "Starred dashboards";

export function OrganizationStarredSection() {
  const links = useOrganizationStars();
  const [isExpanded, setIsExpanded] = useState(true);
  if (links.length === 0) return null;
  return (
    <SidebarSection
      label={LABEL}
      heading={
        // The design's chevron shows open too; folded, the section draws its own.
        <HStack gap={1}>
          <SidebarSectionLabel label={LABEL} />
          {isExpanded && <ChevronDown size={11} aria-hidden opacity={0.5} />}
        </HStack>
      }
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      showExpanded
    >
      <VStack
        as="ul"
        aria-label={LABEL}
        align="stretch"
        gap={0.5}
        margin={0}
        padding={0}
        width="full"
      >
        {links.slice(0, STARRED_SHOWN_MAX).map((link) => (
          <SidebarLinkRow
            key={link.key}
            name={link.name}
            href={link.href}
            icon={<LayoutDashboard size={14} />}
          />
        ))}
        {links.length > STARRED_SHOWN_MAX && (
          <SidebarLinkRow
            name={`All starred (${links.length})`}
            href={ORGANIZATION_DASHBOARDS_PATH}
          />
        )}
      </VStack>
    </SidebarSection>
  );
}
