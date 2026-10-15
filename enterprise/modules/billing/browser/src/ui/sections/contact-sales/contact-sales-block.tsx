import { Link } from "@langwatch/browser-host/link";
import { AccessState } from "@langwatch/design-system/access-state";
/**
 * Contact Sales Block - CTA for enterprise or higher-tier needs
 */
import { Button, HStack, SimpleGrid, Text } from "@langwatch/design-system/primitives";
import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";
import { Check } from "lucide-react";

import { ENTERPRISE_PLAN_FEATURES } from "../../../model/billing-plans.ts";

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
      <SimpleGrid
        data-testid="enterprise-features-list"
        templateColumns={{ base: "1fr", md: "1fr 1.4fr 1fr" }}
        gap={2}
        marginTop={4}
        color="fg.muted"
      >
        {ENTERPRISE_PLAN_FEATURES.map((feature) => (
          <HStack key={feature} gap={2} alignItems="start">
            <Check size={16} />
            <Text fontSize="sm">{feature}</Text>
          </HStack>
        ))}
      </SimpleGrid>
    </AccessState>
  );
}
