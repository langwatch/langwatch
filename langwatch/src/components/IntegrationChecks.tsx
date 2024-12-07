import { VStack, List, ListIcon, ListItem, Link, Text } from "@chakra-ui/react";
import { CheckCircleIcon } from "@chakra-ui/icons";
import { Circle } from "react-feather";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { trackEventOnce } from "../utils/tracking";
import { useEffect } from "react";

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
    project?.id,
  ]);

  return integrationChecks;
};

export const IntegrationChecks = () => {
  const { project } = useOrganizationTeamProject();

  const integrationChecks = useIntegrationChecks();

  return (
    <VStack align="start" fontSize="15px">
      <List spacing={4}>
        <ListItem
          as={Link}
          className="group"
          display="block"
          href={`/settings/projects`}
        >
          <ListIcon as={CheckCircleIcon} color={"green.500"} />
          Create first project
        </ListItem>
        <ListItem
          as={Link}
          className="group"
          display="block"
          href={`/${project?.id}/messages`}
        >
          <ListIcon
            as={integrationChecks.data?.firstMessage ? CheckCircleIcon : Circle}
            color={
              integrationChecks.data?.firstMessage ? "green.500" : "gray.500"
            }
          />
          <Text
            display="inline"
            borderBottomWidth="1px"
            borderColor="gray.350"
            borderStyle="dashed"
            _groupHover={{ border: "none" }}
          >
            Sync your first message
          </Text>
        </ListItem>
        <ListItem
          as={Link}
          className="group"
          display="block"
          href={`/${project?.id}/evaluations`}
        >
          <ListIcon
            as={integrationChecks.data?.evaluations ? CheckCircleIcon : Circle}
            color={
              integrationChecks.data?.evaluations ? "green.500" : "gray.500"
            }
          />
          <Text
            display="inline"
            borderBottomWidth="1px"
            borderColor="gray.350"
            borderStyle="dashed"
            _groupHover={{ border: "none" }}
          >
            Set up your first evaluation
          </Text>
        </ListItem>
        <ListItem
          as={Link}
          className="group"
          display="block"
          href="https://docs.langwatch.ai/features/triggers"
          isExternal
        >
          <ListIcon
            as={integrationChecks.data?.triggers ? CheckCircleIcon : Circle}
            color={integrationChecks.data?.triggers ? "green.500" : "gray.500"}
          />
          <Text
            display="inline"
            borderBottomWidth="1px"
            borderColor="gray.350"
            borderStyle="dashed"
            _groupHover={{ border: "none" }}
          >
            Set up an alert
          </Text>
        </ListItem>
        <ListItem
          as={Link}
          className="group"
          display="block"
          href="https://docs.langwatch.ai/features/datasets"
          isExternal
        >
          <ListIcon
            as={integrationChecks.data?.datasets ? CheckCircleIcon : Circle}
            color={integrationChecks.data?.datasets ? "green.500" : "gray.500"}
          />
          <Text
            display="inline"
            borderBottomWidth="1px"
            borderColor="gray.350"
            borderStyle="dashed"
            _groupHover={{ border: "none" }}
          >
            Create a dataset from the messages
          </Text>
        </ListItem>
        <ListItem
          as={Link}
          className="group"
          display="block"
          href={`/${project?.id}/analytics/reports`}
        >
          <ListIcon
            as={integrationChecks.data?.customGraphs ? CheckCircleIcon : Circle}
            color={
              integrationChecks.data?.customGraphs ? "green.500" : "gray.500"
            }
          />
          <Text
            display="inline"
            borderBottomWidth="1px"
            borderColor="gray.350"
            borderStyle="dashed"
            _groupHover={{ border: "none" }}
          >
            Create a custom dashboard
          </Text>
        </ListItem>
      </List>
    </VStack>
  );
};
