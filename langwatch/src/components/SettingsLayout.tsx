import { Box, Container, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { usePathname } from "~/utils/compat/next-navigation";
import { type PropsWithChildren, useEffect, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useLiteMemberGuard } from "~/hooks/useLiteMemberGuard";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
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
    <VStack align="start" width="full" gap={0}>
      <HStack
        width="full"
        px={4}
        py={1}
        cursor="pointer"
        color="fg.muted"
        _hover={{ color: "fg" }}
        onClick={() => setOpen((v) => !v)}
      >
        <Text
          fontSize="xs"
          fontWeight="semibold"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          {label}
        </Text>
        <Box ml="auto">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Box>
      </HStack>
      {open && (
        <VStack align="start" width="full" gap={1} pl={2}>
          {children}
        </VStack>
      )}
    </VStack>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function SettingsLayout({
  children,
  isSubscription,
}: PropsWithChildren<{ isSubscription?: boolean }>) {
  const { project, hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS ?? false;
  const { isEnterprise } = useActivePlan();
  const { isLiteMember } = useLiteMemberGuard();
  const { hasAccess: hasOpsAccess } = useOpsPermission();

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
          <MenuLink href="/settings">General Settings</MenuLink>
          {!isLiteMember && (
            <MenuLink href={`/${project?.slug}/setup`}>API Key</MenuLink>
          )}

          <NavSection
            label="Models"
            paths={[
              "/settings/model-providers",
              "/settings/model-costs",
              "/settings/secrets",
            ]}
          >
            <MenuLink href="/settings/model-costs">Model Costs</MenuLink>
            <MenuLink href="/settings/model-providers">Model Providers</MenuLink>
            {!isLiteMember && (
              <MenuLink href="/settings/secrets">Secrets</MenuLink>
            )}
          </NavSection>

          <NavSection
            label="Teams & Access"
            paths={[
              "/settings/teams",
              "/settings/members",
              "/settings/groups",
              "/settings/roles",
              "/settings/access-audit",
              "/settings/authentication",
              "/settings/scim",
              "/settings/audit-log",
            ]}
          >
            <MenuLink href="/settings/members" includePath="members">Members</MenuLink>
            <MenuLink href="/settings/teams">Teams & Projects</MenuLink>
            {isEnterprise && !isLiteMember && (
              <MenuLink href="/settings/groups">Groups</MenuLink>
            )}
            {isEnterprise && !isLiteMember && (
              <MenuLink href="/settings/roles">Roles & Permissions</MenuLink>
            )}
            <MenuLink href="/settings/authentication">Authentication</MenuLink>
            {isEnterprise && !isLiteMember && (
              <MenuLink href="/settings/scim">SCIM Provisioning</MenuLink>
            )}
            {isEnterprise && !isLiteMember && (
              <MenuLink href="/settings/access-audit">Access Audit</MenuLink>
            )}
            {isEnterprise && !isLiteMember && hasPermission("organization:manage") && (
              <MenuLink href="/settings/audit-log">Audit Log</MenuLink>
            )}
          </NavSection>

          <NavSection
            label="Features"
            paths={["/settings/annotation-scores", "/settings/topic-clustering"]}
          >
            <MenuLink href="/settings/annotation-scores">Annotation Scores</MenuLink>
            {!isLiteMember && project?.slug && (
              <MenuLink href={`/${project.slug}/automations`}>Automations</MenuLink>
            )}
            {!isLiteMember && (
              <MenuLink href="/settings/topic-clustering">Topic Clustering</MenuLink>
            )}
          </NavSection>

          {!isLiteMember && (
            <NavSection
              label="Billing"
              paths={["/settings/usage", "/settings/subscription", "/settings/license"]}
            >
              <MenuLink href="/settings/usage">Usage & Billing</MenuLink>
              {isSaaS && (
                <MenuLink href="/settings/subscription">Subscription</MenuLink>
              )}
              {!isSaaS && (
                <MenuLink href="/settings/license">License</MenuLink>
              )}
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
              <MenuLink href="/ops/dejaview" includePath="/ops/dejaview">
                Deja View
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
