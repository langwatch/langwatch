/**
 * Enterprise capabilities section (features, SSO, usage limits).
 * Cloud only; self-hosted shows capabilities and setup guide.
 */

import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Link,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import { ExternalLink, FileClock, KeyRound, TriangleAlert, Users } from "lucide-react";
import { api } from "../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";

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
 * see. Kept to the ones with a real setup guide behind them, so every row leads
 * somewhere useful rather than to a sales page.
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
    description: "A record of who changed what, exportable to your SIEM for compliance reviews.",
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
 * SSO configured but not in use — diagnose license vs. provider startup issues.
 */
function SsoConfiguredButNotInUseNotice() {
  const ssoGate = api.license.getSsoGateStatus.useQuery({}, { refetchOnWindowFocus: false });

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
      data-testid={unlicensed ? "sso-unlicensed-notice" : "sso-not-started-notice"}
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
                so everyone is signing in by email until a license is activated. Activate one and
                restart the server to switch single sign-on on.
              </>
            ) : (
              <>
                but it could not be started, so everyone is signing in by email. Check that the
                provider name is one LangWatch supports and that its client credentials are set,
                then restart the server.
              </>
            )}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}

export function EnterpriseCapabilitiesSection() {
  const host = usePersonalWorkspaceHost();
  const organizationId = host.scope().organizationId ?? "";
  const usage = api.limits.getUsage.useQuery(
    { organizationId },
    {
      enabled: !!organizationId && host.hasPermission("organization:view"),
      retry: false,
    },
  );
  const isEnterprise = usage.data?.activePlan.type === "ENTERPRISE";

  if (host.deployment().isSaas) return null;

  return (
    <>
      <Separator />
      <VStack align="start" gap={4} width="full" data-testid="enterprise-capabilities">
        <SsoConfiguredButNotInUseNotice />

        <VStack align="start" gap={1}>
          <Heading as="h2" size="md">
            Organization sign-in and governance
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            {isEnterprise
              ? "Your license includes these capabilities. Each guide covers how to configure it on your deployment."
              : "These run on the deployment you already have, unlocked by an Enterprise license. Everything else in LangWatch, including unlimited members, teams, and projects, stays uncapped without one."}
          </Text>
        </VStack>

        <VStack align="start" gap={3} width="full">
          {CAPABILITIES.map((capability) => (
            <CapabilityRow key={capability.key} capability={capability} isLicensed={isEnterprise} />
          ))}
        </VStack>

        {!isEnterprise && (
          <HStack gap={3}>
            <Button asChild size="sm" colorPalette="orange">
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
    </>
  );
}
