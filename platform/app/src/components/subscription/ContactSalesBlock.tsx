/**
 * Contact Sales Block - CTA for enterprise or higher-tier needs
 */
import {
  Box,
  Button,
  Card,
  Flex,
  HStack,
  SimpleGrid,
  Text,
} from "@chakra-ui/react";
import { Check } from "lucide-react";
import { Link } from "~/components/ui/link";
import { CONTACT_SALES_URL } from "../../../ee/licensing/constants";
import { ENTERPRISE_PLAN_FEATURES } from "./billing-plans";

export function ContactSalesBlock() {
  return (
    <Card.Root
      data-testid="contact-sales-block"
      borderWidth={1}
      borderColor="border"
    >
      <Card.Body paddingY={5} paddingX={6}>
        <Text fontWeight="semibold" fontSize="lg">
          Need more?
        </Text>
        <SimpleGrid
          data-testid="enterprise-features-list"
          templateColumns={{ base: "1fr", md: "1fr 1.4fr 1fr" }}
          gap={2}
          marginTop={4}
        >
          {ENTERPRISE_PLAN_FEATURES.map((feature) => (
            <HStack key={feature} gap={2} alignItems="start">
              {/* The token prop, not the raw CSS var: `orange.solid` carries
                  its own dark-mode reading. */}
              <Box color="orange.solid" display="flex" flexShrink={0}>
                <Check size={16} />
              </Box>
              <Text fontSize="sm" color="fg.muted">
                {feature}
              </Text>
            </HStack>
          ))}
        </SimpleGrid>
        <Flex justifyContent="flex-end" marginTop={6}>
          <Button asChild variant="outline" size="sm" colorPalette="orange">
            <Link href={CONTACT_SALES_URL} isExternal fontWeight="semibold">
              Contact Sales
            </Link>
          </Button>
        </Flex>
      </Card.Body>
    </Card.Root>
  );
}
