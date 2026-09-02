import { List, Text, VStack } from "@chakra-ui/react";
import { CheckCircle, Circle } from "react-feather";
import { useOrganizationTeamProject } from "../behavior/use-organization-team-project";
import { Link } from "../ui/elements/link";
import { api } from "../behavior/onboarding-api";

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
        <List.Item className="group" display="block" asChild>
          <Link href={`/${project?.slug}/traces`}>
            <List.Indicator
              asChild
              color={integrationChecks.data?.firstMessage ? "green.500" : "gray.500"}
            >
              {integrationChecks.data?.firstMessage ? <CheckCircle /> : <Circle />}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="border.emphasized"
              borderStyle="dashed"
              _groupHover={{ border: "none" }}
            >
              Sync your first message
            </Text>
          </Link>
        </List.Item>
        <List.Item className="group" display="block" asChild>
          <Link href={`/${project?.slug}/workflows`}>
            <List.Indicator
              asChild
              color={integrationChecks.data?.workflows ? "green.500" : "gray.500"}
            >
              {integrationChecks.data?.workflows ? <CheckCircle /> : <Circle />}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="border.emphasized"
              borderStyle="dashed"
              _groupHover={{ border: "none" }}
            >
              Create your first workflow
            </Text>
          </Link>
        </List.Item>
        <List.Item className="group" display="block" asChild>
          <Link href={`/${project?.slug}/online-evaluations`}>
            <List.Indicator
              asChild
              color={integrationChecks.data?.onlineEvaluations ? "green.500" : "gray.500"}
            >
              {integrationChecks.data?.onlineEvaluations ? <CheckCircle /> : <Circle />}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="border.emphasized"
              borderStyle="dashed"
              _groupHover={{ border: "none" }}
            >
              Set up your first online evaluation
            </Text>
          </Link>
        </List.Item>
        <List.Item className="group" display="block" asChild>
          <Link href="https://docs.langwatch.ai/features/automations" isExternal>
            <List.Indicator
              asChild
              color={integrationChecks.data?.triggers ? "green.500" : "gray.500"}
            >
              {integrationChecks.data?.triggers ? <CheckCircle /> : <Circle />}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="border.emphasized"
              borderStyle="dashed"
              _groupHover={{ border: "none" }}
            >
              Set up an alert
            </Text>
          </Link>
        </List.Item>
        <List.Item className="group" display="block" asChild>
          <Link href="https://docs.langwatch.ai/datasets/overview" isExternal>
            <List.Indicator
              asChild
              color={integrationChecks.data?.datasets ? "green.500" : "gray.500"}
            >
              {integrationChecks.data?.datasets ? <CheckCircle /> : <Circle />}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="border.emphasized"
              borderStyle="dashed"
              _groupHover={{ border: "none" }}
            >
              Create a dataset from the messages
            </Text>
          </Link>
        </List.Item>
        <List.Item className="group" display="block" asChild>
          <Link href={`/${project?.slug}/analytics/reports`}>
            <List.Indicator
              asChild
              color={integrationChecks.data?.customGraphs ? "green.500" : "gray.500"}
            >
              {integrationChecks.data?.customGraphs ? <CheckCircle /> : <Circle />}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="border.emphasized"
              borderStyle="dashed"
              _groupHover={{ border: "none" }}
            >
              Create a custom dashboard
            </Text>
          </Link>
        </List.Item>
      </List.Root>
    </VStack>
  );
};
