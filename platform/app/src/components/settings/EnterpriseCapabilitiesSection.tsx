import {
  Badge,
  Box,
  Button,
  HStack,
  Link,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  ExternalLink,
  FileClock,
  KeyRound,
  TriangleAlert,
  Users,
} from "lucide-react";

import { SettingsSection } from "~/components/settings/SettingsSection";
import { useActivePlan } from "~/hooks/useActivePlan";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";

const DOCS_BASE = "https://docs.langwatch.ai";

type Capability = {
  key: string;
  name: string;
  icon: LucideIcon;
  description: string;
  docsPath: string;
};

/**
 * The capabilities a license unlocks that an operator would otherwise never
 * see. Kept to the ones with a real setup guide behind them, so every row
 * leads somewhere useful rather than to a sales page.
 */
const CAPABILITIES = [
  {
    key: "sso",
    name: "Single sign-on",
    icon: KeyRound,
    description:
      "Let your team sign in with Okta, Auth0, Azure AD, Google, or another identity provider instead of a password.",
    docsPath: "/self-hosting/configuration/sso",
  },
  {
    key: "scim",
    name: "SCIM provisioning",
    icon: Users,
    description:
      "Create, update, and deactivate members automatically from your directory, so leavers lose access without a manual step.",
    docsPath: "/platform/scim",
  },
  {
    key: "audit-logs",
    name: "Audit logs",
    icon: FileClock,
    description:
      "A record of who changed what, exportable to your SIEM for compliance reviews.",
    docsPath: "/ai-governance/audit-log",
  },
] as const satisfies readonly Capability[];

function CapabilityRow({
  capability,
  isLicensed,
}: {
  capability: Capability;
  isLicensed: boolean;
}) {
  const Icon = capability.icon;

  return (
    <HStack
      align="start"
      gap={4}
      padding={4}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      width="full"
    >
      <Box color="fg.muted" paddingTop={1}>
        <Icon size={20} />
      </Box>
      <VStack align="start" gap={1} flex={1}>
        <HStack gap={2}>
          <Text fontWeight="medium">{capability.name}</Text>
          {isLicensed ? (
            <Badge colorPalette="green" size="sm" variant="surface">
              Available
            </Badge>
          ) : (
            <Badge colorPalette="orange" size="sm" variant="surface">
              Enterprise license
            </Badge>
          )}
        </HStack>
        <Text color="fg.muted" fontSize="sm">
          {capability.description}
        </Text>
        <Link
          href={`${DOCS_BASE}${capability.docsPath}`}
          target="_blank"
          rel="noopener noreferrer"
          fontSize="sm"
          color="blue.600"
        >
          <HStack gap={1}>
            <Text>Setup guide</Text>
            <ExternalLink size={12} />
          </HStack>
        </Link>
      </VStack>
    </HStack>
  );
}

/**
 * Lists the capabilities an Enterprise license unlocks on a self-hosted
 * deployment, licensed or not. Hiding a paid feature entirely makes it look
 * missing rather than purchasable, and leaves an operator with no way to find
 * the setup guide.
 *
 * Cloud renders nothing: there these are provisioned by LangWatch as part of
 * the plan, so the section would be noise on a page about sign-in methods. The
 * panel belongs to the section for that reason — a Cloud deployment gets no
 * empty card where this would have been.
 */
/**
 * The states an operator cannot diagnose from the page alone: an identity
 * provider is configured, everybody is signing in by email anyway, and the
 * reason is either a license the deployment does not hold or a provider that
 * never started. The gate logs both at startup, but nobody reads server logs
 * to explain a login screen, and email mode looks identical to a deployment
 * that never wanted single sign-on.
 *
 * Each cause is fixed somewhere else, so each gets its own remedy rather than
 * one message covering both.
 */
function SsoConfiguredButNotInUseNotice() {
  const ssoGate = api.license.getSsoGateStatus.useQuery(
    {},
    { refetchOnWindowFocus: false },
  );

  const gate = ssoGate.data;
  if (!gate?.configuredProvider) return null;
  if (gate.licensed && gate.mounted) return null;

  // An unlicensed deployment has not tried to mount anything, so the license is
  // the cause to report even when both look unsatisfied.
  const unlicensed = !gate.licensed;

  return (
    <Box
      borderWidth="1px"
      borderColor="orange.300"
      backgroundColor="orange.50"
      borderRadius="lg"
      padding={4}
      width="full"
      data-testid={
        unlicensed ? "sso-unlicensed-notice" : "sso-not-started-notice"
      }
      _dark={{ backgroundColor: "orange.950", borderColor: "orange.700" }}
    >
      <HStack align="start" gap={3}>
        <Box color="orange.600" paddingTop={0.5}>
          <TriangleAlert size={18} />
        </Box>
        <VStack align="start" gap={1}>
          <Text fontWeight="medium">
            {unlicensed
              ? "Single sign-on is configured but not licensed on this deployment"
              : "Single sign-on is configured but could not be started"}
          </Text>
          <Text color="fg.muted" fontSize="sm">
            This deployment is set up for <b>{gate.configuredProvider}</b>,{" "}
            {unlicensed ? (
              <>
                so everyone is signing in by email until a license is activated.
                Activate one and restart the server to switch single sign-on on.
              </>
            ) : (
              <>
                but it could not be started, so everyone is signing in by email.
                Check that the provider name is one LangWatch supports and that
                its client credentials are set, then restart the server.
              </>
            )}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}

export function EnterpriseCapabilitiesSection() {
  const publicEnv = usePublicEnv();
  const { isEnterprise } = useActivePlan();

  const isSelfHosted = publicEnv.data?.IS_SAAS === false;
  if (!isSelfHosted) return null;

  return (
    // The section chrome and the header are the page's now (`SettingsSection`),
    // so this no longer draws a separator above itself or a heading of a
    // different size from every other section's.
    <SettingsSection
      icon={<Building2 size={18} />}
      title="Organization sign-in and governance"
      description={
        isEnterprise
          ? "Your license includes these capabilities. Each guide covers how to configure it on your deployment."
          : "These run on the deployment you already have, unlocked by an Enterprise license."
      }
      testId="enterprise-capabilities-settings-section"
    >
      <VStack
        align="start"
        gap={4}
        width="full"
        data-testid="enterprise-capabilities"
      >
        <SsoConfiguredButNotInUseNotice />

        {!isEnterprise ? (
          <Text fontSize="sm" lineHeight="1.55" color="fg.muted">
            Everything else in LangWatch, including unlimited members, teams,
            and projects, stays uncapped without one.
          </Text>
        ) : null}

        <VStack align="start" gap={3} width="full">
          {CAPABILITIES.map((capability) => (
            <CapabilityRow
              key={capability.key}
              capability={capability}
              isLicensed={isEnterprise}
            />
          ))}
        </VStack>

        {!isEnterprise && (
          <HStack gap={3}>
            {/* The label colour is stated, not left to the palette: rendered
                through `asChild` onto an anchor, the solid recipe's contrast
                colour did not reach the text in light mode and the button
                read as dark ink on orange. White holds on every orange this
                button wears, resting or hovered, in both modes. */}
            <Button
              asChild
              size="sm"
              colorPalette="orange"
              color="white"
              _hover={{ color: "white" }}
            >
              <a href="/settings/license">Activate a license</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a
                href={`${DOCS_BASE}/self-hosting/licensing`}
                target="_blank"
                rel="noopener noreferrer"
              >
                How licensing works
              </a>
            </Button>
          </HStack>
        )}
      </VStack>
    </SettingsSection>
  );
}
