import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import { BrowserSessionsSection } from "../../components/me/BrowserSessionsSection";
import { PersonalApiKeysSummary } from "../../components/me/PersonalApiKeysSummary";
import { ProfileDetailsSection } from "../../components/me/ProfileDetailsSection";
import { SignInMethodsSummary } from "../../components/me/SignInMethodsSummary";
import SettingsLayout from "../../components/SettingsLayout";
import { SETTINGS_BAND_PADDING_Y } from "../../components/settings/SettingsSection";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

/**
 * Profile: everything this account IS, as its owner reads it.
 *
 * The second of the two YOU pages, beside Security
 * (specs/navigation/settings-shell-v2.feature). The split between them is the
 * difference between READING and DOING: this page answers "who am I here, how
 * do I get in, where am I signed in, what keys do I hold", and Security is
 * where the ways in are actually changed.
 *
 * FOUR BANDS, in the order somebody scans them:
 *
 *   your details ──► sign-in methods ──► where you are signed in ──► your keys
 *
 * The name and photo lead because they are what everybody else sees. Then how
 * you prove you are that person, then where that proof is currently being
 * held, then the credentials that act as you without a browser at all. Each
 * one is a narrower kind of "you" than the one above it.
 *
 * ONE MUTATION SURFACE PER SUBJECT. The name and the photo are changed here
 * because nowhere else changes them. Everything else on the page is a
 * SUMMARY with a link: addresses, passkeys and passwords are managed on
 * Security, and API keys on the API Keys page. A second place to add an
 * address would be a second place for the detach guards to be worded
 * differently, and a second place to mint a key would be a second ceremony to
 * keep in step. Signing one browser out is the exception, and it is the one
 * act that has no other home.
 *
 * NO ORGANIZATION PERMISSION. A member with no authority over the
 * organization still has a name, a photo, sign-in methods and browsers. The
 * organization is read for two things only: where the photo is stored, and
 * which keys are the reader's. Both stand down without one.
 *
 * WHAT THE DATA DOES NOT HOLD, and what is therefore not on the page: a job
 * title (no such field exists on a person), and a session lifetime an
 * organization sets (no such setting exists — each browser states its own
 * activity instead).
 *
 * Spec: specs/settings/profile.feature
 */
export default function ProfileSettings() {
  const { organization, organizationRole } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const standing =
    organization && organizationRole
      ? {
          organizationName: organization.name,
          role: organizationRoleLabel(organizationRole),
        }
      : null;

  return (
    <SettingsLayout>
      <Box
        paddingX={{ base: 4, md: 6 }}
        paddingY={4}
        width="full"
        maxWidth="820px"
      >
        {/* The header carries the bands' own measure underneath it, so the
            distance from the title to the first rule matches Security's. */}
        <VStack align="start" gap={1} paddingBottom={SETTINGS_BAND_PADDING_Y}>
          <Heading size="lg">Profile</Heading>
          <Text color="fg.muted">
            Who you are here, how you get in, and where you are signed in.
          </Text>
        </VStack>

        <ProfileDetailsSection
          organizationId={organization?.id ?? null}
          standing={standing}
        />
        <SignInMethodsSummary />
        <BrowserSessionsSection />
        <PersonalApiKeysSummary organizationId={organization?.id ?? null} />
      </Box>
    </SettingsLayout>
  );
}

/**
 * Where somebody stands in an organization, in a word a colleague would use.
 *
 * The engine's word for the third one is EXTERNAL, which reads as "not one of
 * us" on a page about being one of us. Guest is what the seat actually is.
 */
function organizationRoleLabel(role: string): string {
  if (role === "ADMIN") return "Admin";
  if (role === "EXTERNAL") return "Guest";
  return "Member";
}
