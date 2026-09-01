/**
 * The AI Gateway section navigation, as data.
 *
 * Harvested from `platform/app/src/features/navigation/sectionNavItems.ts`,
 * which also carries the governance list and is read by the product sidebar the
 * application still renders. A feature-web package may not import it, so the
 * gateway rows are copied here and the platform list keeps its own copy for the
 * sidebar.
 *
 * THAT DUPLICATION IS DATA, NOT LOGIC, and it is temporary: the two lists must
 * agree about what exists, and today nothing enforces that. It resolves when
 * the sidebar itself moves and the platform rows are deleted. Adding a row to
 * one and not the other shows the page in one shell and not the other, which is
 * the failure to watch for until then.
 *
 * Model Providers is a `/settings` address rather than a `/gateway` one, and
 * that is not a mistake: the providers a key reaches are configured once for
 * the whole organization, and the rail links out to where they live.
 *
 * Icons are component references, never JSX, exactly as the platform list has
 * them: the renderer decides the size.
 */

import type { LucideIcon } from "lucide-react";
import {
  Brain,
  Gauge,
  KeyRound,
  LineChart,
  ReceiptText,
  Route,
  Shield,
  Webhook,
  Zap,
} from "lucide-react";

export interface GatewayNavItem {
  label: string;
  href: string;
  includePath?: string;
  icon: LucideIcon;
  /** Listed only while this frontend flag is on. */
  featureFlag?: string;
}

export const gatewayNavItems: readonly GatewayNavItem[] = [
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
