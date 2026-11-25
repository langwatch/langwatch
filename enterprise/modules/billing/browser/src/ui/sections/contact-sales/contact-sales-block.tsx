import { Link } from "@langwatch/browser-host/link";
import { AccessState } from "@langwatch/design-system/access-state";
/**
 * Contact Sales Block - CTA for enterprise or higher-tier needs
 */
import { Button } from "@langwatch/design-system/primitives";
import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";

import { ENTERPRISE_PLAN_FEATURES } from "../../../model/billing-plans.ts";
import { PlanFeatureList } from "../../elements/plan-feature-list.tsx";

export function ContactSalesBlock() {
  return (
    <AccessState
      kind="upgrade"
      title="Get more with Enterprise"
      description="Bring your security, access and support requirements. We'll help you find the right plan for your organization."
      data-testid="contact-sales-block"
      actions={
        <Button asChild colorPalette="orange" size="sm">
          <Link href={CONTACT_SALES_URL} isExternal>
            Contact sales
          </Link>
        </Button>
      }
    >
      <PlanFeatureList features={ENTERPRISE_PLAN_FEATURES} data-testid="enterprise-features-list" />
    </AccessState>
  );
}
