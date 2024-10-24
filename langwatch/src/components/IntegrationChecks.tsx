import { VStack, Heading, List, ListIcon, ListItem } from "@chakra-ui/react";
import { CheckCircleIcon } from "@chakra-ui/icons";
import { CheckCircle, Settings, Circle } from "react-feather";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export const IntegrationChecks = () => {
  const { project } = useOrganizationTeamProject();

  const integrationChecks = api.integrationsChecks.getCheckStatus.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchOnWindowFocus: false }
  );

  return (
    <VStack align="start">
      <List spacing={3}>
        <ListItem>
          <ListIcon as={CheckCircleIcon} color={"green.500"} />
          Create first project
        </ListItem>
        <ListItem>
          <ListIcon
            as={integrationChecks.data?.project ? CheckCircleIcon : Circle}
            color={integrationChecks.data?.project ? "green.500" : "gray.500"}
          />
          Sync your first message
        </ListItem>
        <ListItem>
          <ListIcon
            as={integrationChecks.data?.checks ? CheckCircleIcon : Circle}
            color={integrationChecks.data?.checks ? "green.500" : "gray.500"}
          />
          Set up your first evaluation
        </ListItem>
        <ListItem>
          <ListIcon
            as={integrationChecks.data?.triggers ? CheckCircleIcon : Circle}
            color={integrationChecks.data?.triggers ? "green.500" : "gray.500"}
          />
          Set up an alert
        </ListItem>
        <ListItem>
          <ListIcon
            as={integrationChecks.data?.datasets ? CheckCircleIcon : Circle}
            color={integrationChecks.data?.datasets ? "green.500" : "gray.500"}
          />
          Create a dataset from the messages
        </ListItem>
        <ListItem>
          <ListIcon
            as={integrationChecks.data?.customGraphs ? CheckCircleIcon : Circle}
            color={
              integrationChecks.data?.customGraphs ? "green.500" : "gray.500"
            }
          />
          Create a custom dashboard
        </ListItem>
      </List>
    </VStack>
  );
};
