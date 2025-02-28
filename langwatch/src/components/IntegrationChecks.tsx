import { VStack, List, Text } from "@chakra-ui/react";
import { Circle, CheckCircle } from "react-feather";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { trackEventOnce } from "../utils/tracking";
import { useEffect } from "react";
import { Link } from "../components/ui/link";

export const useIntegrationChecks = () => {
  const { project } = useOrganizationTeamProject();

  const integrationChecks = api.integrationsChecks.getCheckStatus.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
      refetchOnWindowFocus: true,
      refetchOnMount: false,
      staleTime: Infinity,
    }
  );

  useEffect(() => {
    if (integrationChecks.data?.firstMessage) {
      trackEventOnce("integration_checks_first_message", {
        project_id: project?.id,
      });
    }
    if (integrationChecks.data?.integrated) {
      trackEventOnce("integration_checks_first_integration", {
        project_id: project?.id,
      });
    }
    if (integrationChecks.data?.workflows) {
      trackEventOnce("integration_checks_first_workflow", {
        project_id: project?.id,
      });
    }
    if (integrationChecks.data?.evaluations) {
      trackEventOnce("integration_checks_first_evaluation", {
        project_id: project?.id,
      });
    }
    if (integrationChecks.data?.triggers) {
      trackEventOnce("integration_checks_first_alert", {
        project_id: project?.id,
      });
    }
    if (integrationChecks.data?.datasets) {
      trackEventOnce("integration_checks_first_dataset", {
        project_id: project?.id,
      });
    }
    if (integrationChecks.data?.customGraphs) {
      trackEventOnce("integration_checks_first_custom_dashboard", {
        project_id: project?.id,
      });
    }
  }, [
    integrationChecks.data?.customGraphs,
    integrationChecks.data?.datasets,
    integrationChecks.data?.evaluations,
    integrationChecks.data?.firstMessage,
    integrationChecks.data?.integrated,
    integrationChecks.data?.triggers,
    integrationChecks.data?.workflows,
    project?.id,
  ]);

  return integrationChecks;
};

export const IntegrationChecks = () => {
  const { project } = useOrganizationTeamProject();

  const integrationChecks = useIntegrationChecks();

  return (
    <VStack align="start" fontSize="15px">
      <List.Root gap={4}>
        <List.Item className="group" display="block" asChild>
          <Link href={`/settings/projects`}>
            <List.Indicator asChild color="green.500">
              <CheckCircle />
            </List.Indicator>
            Create first project
          </Link>
        </List.Item>
        <List.Item className="group" display="block" asChild>
          <Link href={`/${project?.slug}/messages`}>
            <List.Indicator
              asChild
              color={
                integrationChecks.data?.firstMessage ? "green.500" : "gray.500"
              }
            >
              {integrationChecks.data?.firstMessage ? (
                <CheckCircle />
              ) : (
                <Circle />
              )}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="gray.350"
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
              color={
                integrationChecks.data?.workflows ? "green.500" : "gray.500"
              }
            >
              {integrationChecks.data?.workflows ? <CheckCircle /> : <Circle />}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="gray.350"
              borderStyle="dashed"
              _groupHover={{ border: "none" }}
            >
              Create your first workflow
            </Text>
          </Link>
        </List.Item>
        <List.Item className="group" display="block" asChild>
          <Link href={`/${project?.slug}/evaluations`}>
            <List.Indicator
              asChild
              color={
                integrationChecks.data?.evaluations ? "green.500" : "gray.500"
              }
            >
              {integrationChecks.data?.evaluations ? (
                <CheckCircle />
              ) : (
                <Circle />
              )}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="gray.350"
              borderStyle="dashed"
              _groupHover={{ border: "none" }}
            >
              Set up your first evaluation
            </Text>
          </Link>
        </List.Item>
        <List.Item className="group" display="block" asChild>
          <Link href="https://docs.langwatch.ai/features/triggers" isExternal>
            <List.Indicator
              asChild
              color={
                integrationChecks.data?.triggers ? "green.500" : "gray.500"
              }
            >
              {integrationChecks.data?.triggers ? <CheckCircle /> : <Circle />}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="gray.350"
              borderStyle="dashed"
              _groupHover={{ border: "none" }}
            >
              Set up an alert
            </Text>
          </Link>
        </List.Item>
        <List.Item className="group" display="block" asChild>
          <Link href="https://docs.langwatch.ai/features/datasets" isExternal>
            <List.Indicator
              asChild
              color={
                integrationChecks.data?.datasets ? "green.500" : "gray.500"
              }
            >
              {integrationChecks.data?.datasets ? <CheckCircle /> : <Circle />}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="gray.350"
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
              color={
                integrationChecks.data?.customGraphs ? "green.500" : "gray.500"
              }
            >
              {integrationChecks.data?.customGraphs ? (
                <CheckCircle />
              ) : (
                <Circle />
              )}
            </List.Indicator>
            <Text
              display="inline"
              borderBottomWidth="1px"
              borderColor="gray.350"
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
