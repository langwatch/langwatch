/**
 * Security settings page (/settings/security), renamed from Authentication
 * (now a redirect). Four bands: what "sam" is known by, the two proofs, the
 * password.
 */

import { Box, Heading, Text, VStack } from "@langwatch/design-system/primitives";
import { SETTINGS_BAND_PADDING_Y } from "@langwatch/design-system/settings-section";

import { TwoStepVerificationSection } from "../../../features/two-step-verification/ui/sections/two-step-verification-section.tsx";
import { EmailAndLinkedAccountsSection } from "../email-and-linked-accounts-section.tsx";
import { EnterpriseCapabilitiesSection } from "../enterprise-capabilities-section.tsx";
import { PasskeysSection } from "../passkeys-section.tsx";
import { PasswordSection } from "../password-section.tsx";

export default function SecurityScreen() {
  return (
    <Box paddingX={{ base: 4, md: 6 }} paddingY={4} width="full" maxWidth="820px">
      <VStack align="start" gap={1} paddingBottom={SETTINGS_BAND_PADDING_Y}>
        <Heading size="lg">Security</Heading>
        <Text color="fg.muted">
          The ways you sign in, and how you would get back in if you lost one of them.
        </Text>
      </VStack>

      <EmailAndLinkedAccountsSection />

      {/* Above the password, deliberately. The order of this page is an
          argument about what an account should be secured with, and putting the
          thing we would rather people used underneath the thing we would rather
          they stopped using makes the opposite one. */}
      <PasskeysSection />

      <TwoStepVerificationSection />

      <PasswordSection />

      <EnterpriseCapabilitiesSection />
    </Box>
  );
}
