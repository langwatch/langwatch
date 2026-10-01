import { Link } from "@langwatch/browser-host/link";
/**
 * Contact Sales Block - CTA for enterprise or higher-tier needs
 */
import { Button, Card, Flex, HStack, SimpleGrid, Text } from "@langwatch/design-system/primitives";
import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";
import { Check } from "lucide-react";

import { ENTERPRISE_PLAN_FEATURES } from "../../../model/billing-plans.ts";

export function ContactSalesBlock() {
  return (
    <Card.Root data-testid="contact-sales-block">
      <Card.Body paddingY={5} paddingX={6}>
        <Text fontWeight="semibold" fontSize="lg">
          Need more?
        </Text>
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
        <Flex justifyContent="flex-end" marginTop={6}>
          <Button asChild variant="outline" size="sm" colorPalette="orange">
            <Link
              href={CONTACT_SALES_URL}
              target="_blank"
              rel="noopener noreferrer"
              fontWeight="semibold"
            >
              Contact sales
            </Link>
          </Button>
        </Flex>
      </Card.Body>
    </Card.Root>
  );
}
