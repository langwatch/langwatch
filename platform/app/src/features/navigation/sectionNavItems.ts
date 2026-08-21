import {
  AlertTriangle,
  Brain,
  Eye,
  Gauge,
  KeyRound,
  LineChart,
  type LucideIcon,
  PackageOpen,
  PlugZap,
  ReceiptText,
  Route,
  Shield,
  Wallet,
  Webhook,
  Zap,
} from "lucide-react";

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
    label: "Catalog",
    href: "/governance/ingestion-sources",
    includePath: "/governance/ingestion-sources",
    icon: PlugZap,
  },
  {
    label: "Anomaly Rules",
    href: "/governance/anomaly-rules",
    includePath: "/governance/anomaly-rules",
    icon: AlertTriangle,
  },
  {
    label: "Tool Tiles",
    href: "/governance/tool-catalog",
    includePath: "/governance/tool-catalog",
    icon: PackageOpen,
  },
  {
    label: "Departments",
    href: "/governance/departments",
    includePath: "/governance/departments",
    icon: Wallet,
  },
];
