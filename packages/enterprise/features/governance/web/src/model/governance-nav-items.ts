/**
 * The governance section navigation, as data.
 *
 * Harvested from `platform/app/src/features/navigation/sectionNavItems.ts`,
 * which also carries the gateway list and is read by the product sidebar the
 * application still renders. A feature-web package may not import it, so the
 * governance rows are copied here and the platform list keeps its own copy for
 * the sidebar.
 *
 * THAT DUPLICATION IS DATA, NOT LOGIC, and it is temporary: the two lists must
 * agree about what exists, and today nothing enforces that. It resolves when
 * the sidebar itself moves and the platform rows are deleted. Adding a row to
 * one and not the other shows the page in one shell and not the other, which is
 * the failure to watch for until then.
 *
 * Icons are component references, never JSX, exactly as the platform list has
 * them: the renderer decides the size.
 */

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Coins, Eye, PackageOpen, ReceiptText, Users } from "lucide-react";

export interface GovernanceNavItem {
  label: string;
  href: string;
  includePath?: string;
  icon: LucideIcon;
  /** Listed only while this frontend flag is on. */
  featureFlag?: string;
}

export const GOVERNANCE_BILLED_COST_FLAG = "release_ui_governance_billed_cost_enabled";

export const governanceNavItems: readonly GovernanceNavItem[] = [
  {
    label: "Overview",
    href: "/governance",
    icon: Eye,
  },
  {
    label: "Costs",
    href: "/governance/costs",
    includePath: "/governance/costs",
    icon: Coins,
    featureFlag: GOVERNANCE_BILLED_COST_FLAG,
  },
  {
    label: "Billed",
    href: "/governance/billed",
    includePath: "/governance/billed",
    icon: ReceiptText,
    featureFlag: GOVERNANCE_BILLED_COST_FLAG,
  },
  {
    label: "Inventory",
    href: "/governance/inventory",
    includePath: "/governance/inventory",
    icon: PackageOpen,
  },
  {
    label: "Anomaly Rules",
    href: "/governance/anomaly-rules",
    includePath: "/governance/anomaly-rules",
    icon: AlertTriangle,
  },
  {
    label: "People",
    href: "/governance/people",
    includePath: "/governance/people",
    icon: Users,
  },
];
