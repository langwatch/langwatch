import {
  Box,
  Collapsible,
  Container,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { type PropsWithChildren, useEffect, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { useNavigationV2ShellActive } from "~/features/navigation/useNavigationV2ShellActive";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useLiteMemberGuard } from "~/hooks/useLiteMemberGuard";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";
import { usePathname } from "~/utils/compat/next-navigation";
import { PageLayout } from "./ui/layouts/PageLayout";

// ── Collapsible nav section ───────────────────────────────────────────────────

function NavSection({
  label,
  paths,
  children,
}: PropsWithChildren<{ label: string; paths: string[] }>) {
  const pathname = usePathname();
  const isActive = paths.some((p) => pathname?.startsWith(p));
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      width="full"
    >
      <VStack align="start" width="full" gap={0}>
        <Collapsible.Trigger asChild>
          <Box as="button" width="full" cursor="pointer">
            <HStack
              width="full"
              px={4}
              py={1}
              color={isActive ? "fg" : "fg.muted"}
              _hover={{ color: "fg" }}
            >
              <Text
                fontSize="xs"
                fontWeight="semibold"
                textTransform="uppercase"
                letterSpacing="wider"
              >
                {label}
              </Text>
              <Box
                ml="auto"
                transform={open ? "rotate(0deg)" : "rotate(-90deg)"}
                transition="transform 0.15s ease-in-out"
              >
                <ChevronDown size={12} />
              </Box>
            </HStack>
          </Box>
        </Collapsible.Trigger>
        {/* Collapsible.Content animates height open/closed; the manual
            `{open && …}` it replaced snapped with no transition. */}
        <Collapsible.Content style={{ width: "100%" }}>
          <VStack align="start" width="full" gap={1} pl={2} pt={1}>
            {children}
          </VStack>
        </Collapsible.Content>
      </VStack>
    </Collapsible.Root>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function SettingsLayout({
  children,
  isSubscription,
}: PropsWithChildren<{ isSubscription?: boolean }>) {
  // Inside a navigation-v2 shell the chrome itself carries the Settings
  // title, the back entry and the regrouped settings menu
  // (specs/navigation/settings-shell-v2.feature), so this layout only
  // frames the content. Legacy mode keeps the full local navigation.
  const isV2Shell = useNavigationV2ShellActive();
  const { hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS ?? false;
  const { isEnterprise, isLoading: isPlanLoading } = useActivePlan();
  const showEnterpriseNav = isPlanLoading || isEnterprise;
  const { isLiteMember } = useLiteMemberGuard();
  const { hasAccess: hasOpsAccess } = useOpsPermission();
  // Backoffice is admin-only. Kept decoupled from `hasOpsAccess` so that if
  // ops:view ever broadens beyond admin, Backoffice stays strictly admin.
  // Query only runs when the OPS section would render.
  const adminStatus = api.user.isAdmin.useQuery(
    {},
    { enabled: hasOpsAccess, retry: false, refetchOnWindowFocus: false },
  );
  const isAdminUser = adminStatus.data?.isAdmin ?? false;

  if (isV2Shell) {
    return (
      <DashboardLayout>
        <Container
          maxWidth="1280px"
          padding={4}
          paddingBottom={16}
          height="full"
          overflowY="auto"
          flex={1}
        >
          {children}
        </Container>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout compactMenu>
      <PageLayout.Header>
        <PageLayout.Heading>Settings</PageLayout.Heading>
      </PageLayout.Header>
      <HStack
        align="start"
        width="full"
        height="calc(100vh - 56px - 48px)"
        gap={0}
      >
        <VStack
          align="start"
          paddingX={2}
          paddingY={4}
          fontSize="14px"
          minWidth="200px"
          height="full"
          overflowY="auto"
          flexShrink={0}
          gap={2}
          display={isSubscription ? "none" : "flex"}
        >
          {/* The reader's own two pages come first, and carry no gate: a
              member with no authority over the organization still has a name,
              a photo and a password. */}
          <NavSection
            label="You"
            paths={["/settings/profile", "/settings/security"]}
          >
            <MenuLink href="/settings/profile">Profile</MenuLink>
            <MenuLink href="/settings/security">Security</MenuLink>
          </NavSection>

          <MenuLink href="/settings">General Settings</MenuLink>
          {!isLiteMember && (
            <MenuLink href="/settings/api-keys">API Keys</MenuLink>
          )}

          <NavSection
            label="Models"
            paths={[
              "/settings/model-providers",
              "/settings/model-costs",
              "/settings/secrets",
            ]}
          >
            <MenuLink href="/settings/model-providers">
              Model Providers
            </MenuLink>
            <MenuLink href="/settings/model-costs">Model Costs</MenuLink>
            {!isLiteMember && (
              <MenuLink href="/settings/secrets">Secrets</MenuLink>
            )}
          </NavSection>

          <NavSection
            label="People & access"
            paths={[
              "/settings/teams",
              "/settings/members",
              "/settings/groups",
              "/settings/roles",
              "/settings/role-bindings",
              "/settings/authentication",
              "/settings/scim",
              "/settings/directory",
              "/settings/access",
              "/settings/audit-log",
            ]}
          >
            <MenuLink href="/settings/members" includePath="members">
              Members
            </MenuLink>
            <MenuLink href="/settings/teams">Teams & Projects</MenuLink>
            {/* Definitions and the grants of those definitions are two tabs
                of one page now; /settings/role-bindings forwards onto the
                second and no longer has an entry of its own. Groups is the
                same shape: it is a tab of Directory, and /settings/groups
                forwards onto it. */}
            {showEnterpriseNav && !isLiteMember && (
              <MenuLink href="/settings/roles">Roles</MenuLink>
            )}
            {/* How the ORGANIZATION signs in; how the reader does is
                Security, under You. Offered only to somebody who may at
                least SEE single sign-on (D05). An administrator without the
                permission is not shown the entry, and the page refuses the
                address as well — the menu is a courtesy, not the gate. */}
            {showEnterpriseNav &&
              !isLiteMember &&
              hasPermission("sso:view") && (
                <MenuLink href="/settings/authentication">
                  Authentication
                </MenuLink>
              )}
            {showEnterpriseNav && !isLiteMember && (
              <MenuLink href="/settings/directory">Directory</MenuLink>
            )}
            <MenuLink href="/settings/access">Access</MenuLink>
            {showEnterpriseNav &&
              !isLiteMember &&
              hasPermission("auditLog:view") && (
                <MenuLink href="/settings/audit-log">Audit Log</MenuLink>
              )}
          </NavSection>

          <NavSection
            label="Features"
            paths={[
              "/settings/annotation-scores",
              "/settings/topic-clustering",
              "/settings/data-retention",
              "/settings/email-suppressions",
              "/settings/integrations",
              "/settings/data-privacy",
            ]}
          >
            <MenuLink href="/settings/data-retention">Data Retention</MenuLink>
            {hasPermission("triggers:view") && (
              <MenuLink href="/settings/email-suppressions">
                Email Suppressions
              </MenuLink>
            )}
            <MenuLink href="/settings/data-privacy">Data Privacy</MenuLink>
            <MenuLink href="/settings/annotation-scores">
              Annotation Scores
            </MenuLink>
            {!isLiteMember && (
              <MenuLink href="/settings/topic-clustering">
                Topic Clustering
              </MenuLink>
            )}
            <MenuLink href="/settings/integrations">Integrations</MenuLink>
          </NavSection>

          {!isLiteMember && (
            <NavSection
              label="Billing"
              paths={[
                "/settings/usage",
                "/settings/subscription",
                "/settings/license",
              ]}
            >
              <MenuLink href="/settings/usage">Usage & Billing</MenuLink>
              {isSaaS && (
                <MenuLink href="/settings/subscription">Subscription</MenuLink>
              )}
              {!isSaaS && <MenuLink href="/settings/license">License</MenuLink>}
            </NavSection>
          )}

          {hasOpsAccess && (
            <NavSection label="Ops" paths={["/ops"]}>
              <MenuLink href="/ops">Dashboard</MenuLink>
              <MenuLink href="/ops/projections" includePath="/ops/projections">
                Projection Replay
              </MenuLink>
              <MenuLink href="/ops/foundry" includePath="/ops/foundry">
                The Foundry
              </MenuLink>
              <MenuLink href="/ops/blobs" includePath="/ops/blobs">
                Payload store
              </MenuLink>
              <MenuLink href="/ops/dejaview" includePath="/ops/dejaview">
                Deja View
              </MenuLink>
              <MenuLink
                href="/ops/feature-flags"
                includePath="/ops/feature-flags"
              >
                Feature Flags
              </MenuLink>
            </NavSection>
          )}

          {isAdminUser && (
            <NavSection label="Backoffice" paths={["/ops/backoffice"]}>
              <MenuLink
                href="/ops/backoffice/users"
                includePath="/ops/backoffice/users"
              >
                Users
              </MenuLink>
              <MenuLink
                href="/ops/backoffice/organizations"
                includePath="/ops/backoffice/organizations"
              >
                Organizations
              </MenuLink>
              <MenuLink
                href="/ops/backoffice/projects"
                includePath="/ops/backoffice/projects"
              >
                Projects
              </MenuLink>
              <MenuLink
                href="/ops/backoffice/subscriptions"
                includePath="/ops/backoffice/subscriptions"
              >
                Subscriptions
              </MenuLink>
              <MenuLink
                href="/ops/backoffice/bug-reports"
                includePath="/ops/backoffice/bug-reports"
              >
                Bug Reports
              </MenuLink>
            </NavSection>
          )}
        </VStack>
        <Container
          maxWidth="1280px"
          padding={4}
          paddingBottom={16}
          height="full"
          overflowY="auto"
          flex={1}
        >
          {children}
        </Container>
      </HStack>
    </DashboardLayout>
  );
}
