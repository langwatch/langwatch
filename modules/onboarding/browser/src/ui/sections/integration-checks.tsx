import { List, Text, VStack } from "@chakra-ui/react";
import { Link } from "@langwatch/onboarding-browser-kit";
import type React from "react";
import { CheckCircle, Circle } from "react-feather";

import { api } from "../../behavior/onboarding-api.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";

interface IntegrationCheckItemProps {
  href: string;
  isExternal?: boolean;
  done?: boolean;
  children: React.ReactNode;
}

function IntegrationCheckItem({
  href,
  isExternal,
  done,
  children,
}: IntegrationCheckItemProps): React.ReactElement {
  return (
    <List.Item className="group" display="block" asChild>
      <Link href={href} isExternal={isExternal}>
        <List.Indicator asChild color={done ? "green.500" : "gray.500"}>
          {done ? <CheckCircle /> : <Circle />}
        </List.Indicator>
        <Text
          display="inline"
          borderBottomWidth="1px"
          borderColor="border.emphasized"
          borderStyle="dashed"
          _groupHover={{ border: "none" }}
        >
          {children}
        </Text>
      </Link>
    </List.Item>
  );
}

export const useIntegrationChecks = () => {
  const { project } = useOrganizationTeamProject();

  const integrationChecks = api.integrationsChecks.getCheckStatus.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
      // Onboarding checklist: staleTime: Infinity is fine here because
      // refetchOnWindowFocus picks up out-of-band changes (first message
      // synced, first workflow created, etc.) when the user returns to the tab.
      refetchOnWindowFocus: true,
      refetchOnMount: false,
      staleTime: Infinity,
    },
  );

  // `trackEventOnce("integration_checks_*")` did NOT travel. Product analytics
  // is the application's — `platform/app/src/utils/tracking` no longer exists to
  // import in any case — and a port method the host could only answer with
  // nothing is worse than its absence. The same line the navigation family drew
  // for `trackEvent("navigation_product_switch")`.
  return integrationChecks;
};

export const IntegrationChecks = () => {
  const { project } = useOrganizationTeamProject();
  const integrationChecks = useIntegrationChecks();
  const checks = integrationChecks.data;

  return (
    <VStack align="start" fontSize="15px">
      <List.Root gap={4}>
        <List.Item className="group" display="block" asChild>
          <Link href={`/settings/teams`}>
            <List.Indicator asChild color="green.500">
              <CheckCircle />
            </List.Indicator>
            Create first project
          </Link>
        </List.Item>
        <IntegrationCheckItem href={`/${project?.slug}/traces`} done={checks?.firstMessage}>
          Sync your first message
        </IntegrationCheckItem>
        <IntegrationCheckItem href={`/${project?.slug}/workflows`} done={checks?.workflows}>
          Create your first workflow
        </IntegrationCheckItem>
        <IntegrationCheckItem
          href={`/${project?.slug}/online-evaluations`}
          done={checks?.onlineEvaluations}
        >
          Set up your first online evaluation
        </IntegrationCheckItem>
        <IntegrationCheckItem
          href="https://docs.langwatch.ai/features/automations"
          isExternal
          done={checks?.triggers}
        >
          Set up an alert
        </IntegrationCheckItem>
        <IntegrationCheckItem
          href="https://docs.langwatch.ai/datasets/overview"
          isExternal
          done={checks?.datasets}
        >
          Create a dataset from the messages
        </IntegrationCheckItem>
        <IntegrationCheckItem
          href={`/${project?.slug}/analytics/reports`}
          done={checks?.customGraphs}
        >
          Create a custom dashboard
        </IntegrationCheckItem>
      </List.Root>
    </VStack>
  );
};
