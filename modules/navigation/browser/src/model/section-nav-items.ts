import type { FrontendFeatureFlag } from "@langwatch/feature-flag-contract";
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

/**
 * The Gateway and Governance section navigations as data: both the legacy
 * rails and navigation-v2 sidebars render from these lists, so the two
 * presentations cannot drift. Icons are component references, never JSX.
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
  /** Extra words the command bar matches this page on. */
  keywords?: readonly string[];
  /** The `data-tour` target the guided tour spotlights on this entry. */
  tourId?: string;
}

export const gatewayNavItems: readonly SectionNavItemData[] = [
  {
    label: "Virtual keys",
    keywords: ["api keys", "keys", "virtual key"],
    href: "/gateway/virtual-keys",
    includePath: "/gateway/virtual-keys",
    icon: KeyRound,
    tourId: "nav-virtual-keys",
  },
  {
    label: "Model providers",
    keywords: ["providers", "openai", "anthropic"],
    href: "/settings/model-providers",
    includePath: "/settings/model-providers",
    icon: Brain,
  },
  {
    label: "Budgets",
    keywords: ["budget", "spend limit", "limits"],
    href: "/gateway/budgets",
    includePath: "/gateway/budgets",
    icon: Gauge,
  },
  {
    label: "Routing policies",
    keywords: ["routing", "fallback", "policy"],
    href: "/gateway/routing-policies",
    includePath: "/gateway/routing-policies",
    icon: Route,
  },
  {
    label: "Cache rules",
    keywords: ["cache", "caching"],
    href: "/gateway/cache-rules",
    includePath: "/gateway/cache-rules",
    icon: Zap,
  },
  {
    label: "Guardrails",
    keywords: ["guardrail", "safety", "policy"],
    href: "/gateway/guardrails",
    includePath: "/gateway/guardrails",
    icon: Shield,
  },
  {
    label: "Usage",
    keywords: ["gateway usage", "tokens", "cost"],
    href: "/gateway/usage",
    includePath: "/gateway/usage",
    icon: LineChart,
  },
  {
    label: "Billing events",
    keywords: ["billing", "invoices"],
    href: "/gateway/billing-events",
    includePath: "/gateway/billing-events",
    icon: ReceiptText,
  },
  {
    label: "Webhooks",
    keywords: ["webhook", "callbacks"],
    href: "/gateway/webhooks",
    includePath: "/gateway/webhooks",
    icon: Webhook,
  },
];

export const governanceNavItems: readonly SectionNavItemData[] = [
  {
    label: "Overview",
    keywords: ["governance", "summary"],
    href: "/governance",
    icon: Eye,
  },
  {
    label: "Costs",
    keywords: ["spend", "billed cost"],
    href: "/governance/costs",
    includePath: "/governance/costs",
    icon: Coins,
    featureFlag: "release_ui_governance_billed_cost_enabled",
  },
  {
    label: "Inventory",
    keywords: ["tools", "licences", "licenses", "ai tools"],
    href: "/governance/inventory",
    includePath: "/governance/inventory",
    icon: PackageOpen,
  },
  {
    // Anomaly Rules left the rail for a tab inside Inventory, and Billed
    // left it for this entry. The /governance/billed page stays reachable
    // by address behind its flag; it is only no longer listed.
    label: "Agents",
    keywords: ["agent", "coding agents"],
    href: "/governance/agents",
    includePath: "/governance/agents",
    icon: Bot,
  },
  {
    label: "People",
    keywords: ["users", "team", "members"],
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
    keywords: ["brief"],
    href: "/governance/insights",
    includePath: "/governance/insights",
    icon: Inbox,
    featureFlag: "release_ui_governance_billed_cost_enabled",
    group: "Platform",
  },
  {
    label: "Analytics",
    keywords: ["explore"],
    href: "/governance/analytics",
    includePath: "/governance/analytics",
    icon: LineChart,
    featureFlag: "release_ui_governance_billed_cost_enabled",
    group: "Platform",
  },
  {
    label: "Signals & Alerts",
    keywords: ["alerts", "signals", "rules", "anomaly"],
    href: "/governance/signals",
    includePath: "/governance/signals",
    icon: Target,
    featureFlag: "release_ui_governance_billed_cost_enabled",
    group: "Platform",
  },
];
