import type { SuiteTemplate } from "@langwatch/suite-contract";
import {
  BookOpen,
  ChartColumn,
  CreditCard,
  FileSearch,
  FileText,
  Fingerprint,
  Headset,
  IdCard,
  Landmark,
  Laptop,
  LayoutTemplate,
  type LucideIcon,
  Mic,
  Scale,
  ShieldAlert,
  ShoppingBag,
  Syringe,
  Wrench,
} from "lucide-react";

/** The icon each shipped template shows on its card; an unlisted one falls back by kind. */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  "support-agent": Headset,
  "retail-support-agent": ShoppingBag,
  "payments-agent": CreditCard,
  "it-helpdesk-agent": Laptop,
  "banking-assistant": Landmark,
  "kyc-onboarding-agent": IdCard,
  "legal-ops-assistant": Scale,
  "claims-intake-agent": FileText,
  "analytics-copilot": ChartColumn,
  "knowledge-assistant": BookOpen,
  "voice-support-agent": Mic,
  "technician-copilot": Wrench,
  "agentic-rag": FileSearch,
  "pii-sensitive-data": Fingerprint,
  "prompt-injection": Syringe,
};

export function SuiteTemplateIcon({ template }: { template: SuiteTemplate }) {
  const Icon =
    TEMPLATE_ICONS[template.id] ??
    (template.kind === "red_team_pack" ? ShieldAlert : LayoutTemplate);
  return <Icon size={18} aria-hidden="true" data-testid={`suite-template-icon-${template.id}`} />;
}
