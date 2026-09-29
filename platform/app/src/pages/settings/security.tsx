import { Box, Heading, Text, VStack } from "@chakra-ui/react";

import { EmailAndLinkedAccountsSection } from "../../components/me/EmailAndLinkedAccountsSection";
import { PasskeysSection } from "../../components/me/PasskeysSection";
import { PasswordSection } from "../../components/me/PasswordSection";
import { TwoFactorSection } from "../../components/me/TwoFactorSection";
import SettingsLayout from "../../components/SettingsLayout";
import { EnterpriseCapabilitiesSection } from "../../components/settings/EnterpriseCapabilitiesSection";
import { SETTINGS_BAND_PADDING_Y } from "../../components/settings/SettingsSection";

/**
 * Security: the reader's own ways in.
 *
 * The first of the two YOU pages, beside Profile
 * (specs/navigation/settings-shell-v2.feature). Available to every signed-in
 * user (no admin gate) — both governance/Personal-Workspace shells and the
 * legacy /[project]/ shell hit this URL through the Settings nav.
 *
 * SECURITY, NOT AUTHENTICATION. The word was the giveaway that the page was
 * filed wrong: it sat among an organization's roles and domains, and it is
 * the one page in Settings a member with no authority at all can still act
 * on. What an ORGANIZATION requires of everybody who signs in — the
 * second-factor requirement, who may join — is on Access, and this page has
 * never held any of it.
 *
 * One-SSO-per-org is the typical enterprise shape; the linked accounts
 * collapse to a status line in that case. Org-wide SSO is still provisioned
 * through env vars / IdP metadata rather than here, so on self-hosted this
 * page also carries the discovery surface for it (see
 * EnterpriseCapabilitiesSection): otherwise an operator has no in-product
 * route to the setup guide at all.
 *
 * ── The page's shape ────────────────────────────────────────────────────
 *
 * A heading and one line under it. An earlier version had neither, on the
 * argument that the settings navigation already says which page this is; the
 * page reads better with them, and that is the decision in force.
 *
 * FOUR bands, in this order:
 *
 *   addresses + linked accounts ──► passkeys ──► two-step ──► password
 *
 * The identifiers lead because they are what the account IS: every other band
 * is a way of proving you are the person those addresses belong to, and the
 * addresses are also the only way back when every proof has gone. Then the two
 * proofs, passkeys first — the order of this page is an argument about what an
 * account should be secured with, and the password sits last for the same
 * reason it always did: putting the thing we would rather people used
 * underneath the thing we would rather they stopped using makes the opposite
 * argument.
 *
 * The addresses and the linked accounts share ONE band because the identity
 * model holds them as one species — both are `Identifier` rows, and the detach
 * guard reasons across the whole set, so the same refusal can come from
 * either. Passkeys and two-step verification were briefly merged on a similar
 * argument and are separate again by decision: what you DO to each has nothing
 * in common, and one heading over both hid the second one.
 *
 * Every band draws its own `SettingsSection` and decides whether it has
 * anything to say, which is why no wrapper lives here: a page that wrapped a
 * band which then rendered nothing would draw a rule with empty space under
 * it.
 *
 * ONE column, and it stays one. A summary rail beside it was tried twice —
 * once counting what the account holds, once advising what to do about it —
 * and neither earned half a screen from a reader who has just scrolled the
 * bands themselves. The one thing worth saying that no band could say alone,
 * that this account is down to a single way in, is said INSIDE the passkeys
 * band, where the first remedy is.
 */
export default function SecuritySettings() {
  return (
    <SettingsLayout>
      <Box
        paddingX={{ base: 4, md: 6 }}
        paddingY={4}
        width="full"
        maxWidth="820px"
      >
        {/* The header carries the bands' own measure underneath it, so the
            distance from the title to the first rule is the distance between
            every other pair of bands. */}
        <VStack align="start" gap={1} paddingBottom={SETTINGS_BAND_PADDING_Y}>
          <Heading size="lg">Security</Heading>
          <Text color="fg.muted">
            The ways you sign in, and how you would get back in if you lost one
            of them.
          </Text>
        </VStack>

        <EmailAndLinkedAccountsSection />
        <PasskeysSection />
        <TwoFactorSection />
        <PasswordSection />
        <EnterpriseCapabilitiesSection />
      </Box>
    </SettingsLayout>
  );
}
