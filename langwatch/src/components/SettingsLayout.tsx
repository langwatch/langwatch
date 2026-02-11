import { Container, HStack, VStack } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { PageLayout } from "./ui/layouts/PageLayout";

export default function SettingsLayout({
  children,
  isSubscription,
}: PropsWithChildren<{ isSubscription?: boolean }>) {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS ?? false;
  const { isEnterprise } = useActivePlan();

  return (
    <DashboardLayout compactMenu>
      <PageLayout.Header>
        <PageLayout.Heading>Settings</PageLayout.Heading>
      </PageLayout.Header>
      <HStack align="start" width="full" height="full">
        <VStack
          align="start"
          paddingX={2}
          paddingY={4}
          fontSize="14px"
          minWidth="200px"
          height="full"
          gap={1}
          display={isSubscription ? "none" : "flex"}
        >
          <MenuLink href="/settings">General Settings</MenuLink>
          <MenuLink href={`/${project?.slug}/setup`}>API Key & Setup</MenuLink>
          <MenuLink href="/settings/model-providers">Model Providers</MenuLink>
          <MenuLink href="/settings/model-costs">Model Costs</MenuLink>
          <MenuLink href={`/${project?.slug}/automations`}>Automations</MenuLink>
          <MenuLink href="/settings/projects">Projects</MenuLink>
          <MenuLink href="/settings/teams">Teams</MenuLink>
          <MenuLink href="/settings/members" includePath="members">
            Members
          </MenuLink>
          {isEnterprise && (
            <MenuLink href="/settings/roles">Roles & Permissions</MenuLink>
          )}
          {isEnterprise && (
            <MenuLink href="/settings/audit-log">Audit Log</MenuLink>
          )}

          <MenuLink href="/settings/annotation-scores">
            Annotation Scores
          </MenuLink>
          <MenuLink href="/settings/topic-clustering">
            Topic Clustering
          </MenuLink>
          <MenuLink href="/settings/authentication">Authentication</MenuLink>
          <MenuLink href="/settings/usage">Usage & Billing</MenuLink>
          {isSaaS && <MenuLink href="/settings/plans">Plans</MenuLink>}
          {isSaaS && <MenuLink href="/settings/subscription">Subscription</MenuLink>}
          {!isSaaS && <MenuLink href="/settings/license">License</MenuLink>}
        </VStack>
        <Container maxWidth="1280px" padding={4} paddingBottom={16}>
          {children}
        </Container>
      </HStack>
    </DashboardLayout>
  );
}
