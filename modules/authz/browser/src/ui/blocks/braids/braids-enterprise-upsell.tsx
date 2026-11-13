// Below Enterprise with nothing braided: what Braids does and a conversation, nothing half works.
// Spec: modules/authz/specs/braids-screen.feature, rule "Below Enterprise the page says what...".

import { Link } from "@langwatch/browser-host/link";
import { AccessState } from "@langwatch/design-system/access-state";
import { FeatureIllustration } from "@langwatch/design-system/feature-illustration";
import { Box, Button, HStack, Stack } from "@langwatch/design-system/primitives";
import { Check } from "lucide-react";

import { BRAIDS_GUIDE_HREF } from "../../../model/braids/braids.ts";

const OFFERS = [
  "Conditions on any attribute",
  "Signed calls",
  "Live preview",
  "Full audit log",
] as const;

export function BraidsEnterpriseUpsell() {
  return (
    <AccessState
      kind="upgrade"
      title="See every agent call, across projects"
      description="Braids show spans from one project inside another project's traces, under conditions your admins control. Braids are part of the Enterprise plan."
      data-testid="braids-enterprise-upsell"
      actions={
        <>
          <Button asChild colorPalette="orange" size="sm">
            <Link href="/settings/plans">Talk to us about Enterprise</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={BRAIDS_GUIDE_HREF} isExternal>
              How braids work
            </Link>
          </Button>
        </>
      }
    >
      <Stack gap={5}>
        <Box
          maxWidth="640px"
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="lg"
          overflow="hidden"
        >
          <FeatureIllustration feature="braids" name="enterprise" />
        </Box>
        <HStack gap={5} flexWrap="wrap" as="ul" listStyleType="none">
          {OFFERS.map((offer) => (
            <HStack as="li" key={offer} gap={1.5} textStyle="sm" color="fg.muted">
              <Box color="fg.success" display="inline-flex">
                <Check size={14} aria-hidden />
              </Box>
              {offer}
            </HStack>
          ))}
        </HStack>
      </Stack>
    </AccessState>
  );
}
