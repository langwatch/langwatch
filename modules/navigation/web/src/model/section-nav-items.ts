import {
  Bot,
  Brain,
  Coins,
  Eye,
  Gauge,
  Inbox,
  KeyRound,
  LineChart,
  type LucideIcon,
  PackageOpen,
  ReceiptText,
  Route,
  Shield,
  Target,
  Users,
  Webhook,
  Zap,
} from "lucide-react";

import type { FrontendFeatureFlag } from "@langwatch/feature-flag-contract";

/**
 * The Gateway and Governance section navigations as data. The legacy
 * SectionNavigationLayout rails and the navigation-v2 product sidebars
 * both render from these lists, so the two presentations cannot drift.
 * Icons are component references, never JSX.
 */
export interface SectionNavItemData {
  label: string;
  href: string;
  includePath?: string;
  icon: LucideIcon;
  /**
   * Listed only while this frontend flag is enabled. Every renderer of
   * these lists must filter through useVisibleSectionNavItems so the two
   * presentations agree on what exists.
   */
  featureFlag?: FrontendFeatureFlag;
  /**
   * Listed under a labelled group in the navigation-v2 sidebar, after
   * every ungrouped entry. The legacy section rail has no grouping
   * affordance and lists grouped entries flat, in the same order.
   */
  group?: string;
}

export const gatewayNavItems: readonly SectionNavItemData[] = [
  {
    label: "Virtual Keys",
    href: "/gateway/virtual-keys",
    includePath: "/gateway/virtual-keys",
    icon: KeyRound,
  },
  {
    label: "Model Providers",
    href: "/settings/model-providers",
    includePath: "/settings/model-providers",
    icon: Brain,
  },
  {
    label: "Budgets",
    href: "/gateway/budgets",
    includePath: "/gateway/budgets",
    icon: Gauge,
  },
  {
    label: "Routing Policies",
    href: "/gateway/routing-policies",
    includePath: "/gateway/routing-policies",
    icon: Route,
  },
  {
    label: "Cache Rules",
    href: "/gateway/cache-rules",
    includePath: "/gateway/cache-rules",
    icon: Zap,
  },
  {
    label: "Guardrails",
    href: "/gateway/guardrails",
    includePath: "/gateway/guardrails",
    icon: Shield,
  },
  {
    label: "Usage",
    href: "/gateway/usage",
    includePath: "/gateway/usage",
    icon: LineChart,
  },
  {
    label: "Billing Events",
    href: "/gateway/billing-events",
    includePath: "/gateway/billing-events",
    icon: ReceiptText,
  },
  {
    label: "Webhooks",
    href: "/gateway/webhooks",
    includePath: "/gateway/webhooks",
    icon: Webhook,
  },
];

export const governanceNavItems: readonly SectionNavItemData[] = [
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
    featureFlag: "release_ui_governance_billed_cost_enabled",
  },
  {
    label: "Inventory",
    href: "/governance/inventory",
    includePath: "/governance/inventory",
    icon: PackageOpen,
  },
  {
    // Anomaly Rules left the rail for a tab inside Inventory, and Billed
    // left it for this entry. The /governance/billed page stays reachable
    // by address behind its flag; it is only no longer listed.
    label: "Agents",
    href: "/governance/agents",
    includePath: "/governance/agents",
    icon: Bot,
  },
  {
    label: "People",
    href: "/governance/people",
    includePath: "/governance/people",
    icon: Users,
  },
  // The Platform group: placeholder screens for the brief, explore and
  // rule registry that the cost work leads into. They ride the billed-cost
  // flag so the audience previewing Costs previews these too.
  // Spec: specs/governance/governance-platform-placeholders.feature
  {
    label: "Insights",
    href: "/governance/insights",
    includePath: "/governance/insights",
    icon: Inbox,
    featureFlag: "release_ui_governance_billed_cost_enabled",
    group: "Platform",
  },
  {
    label: "Analytics",
    href: "/governance/analytics",
    includePath: "/governance/analytics",
    icon: LineChart,
    featureFlag: "release_ui_governance_billed_cost_enabled",
    group: "Platform",
  },
  {
    label: "Signals & Alerts",
    href: "/governance/signals",
    includePath: "/governance/signals",
    icon: Target,
    featureFlag: "release_ui_governance_billed_cost_enabled",
    group: "Platform",
  },
];
