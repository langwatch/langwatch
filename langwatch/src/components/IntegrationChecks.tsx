import { VStack, Heading, List, ListIcon, ListItem } from "@chakra-ui/react";
import { CheckCircleIcon } from "@chakra-ui/icons";
import { CheckCircle, Settings } from "react-feather";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export const IntegrationChecks = () => {
  const { project } = useOrganizationTeamProject();

  const { data } = api.integrationsChecks.getCheckStatus.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchOnWindowFocus: false }
  );

  return (
    <VStack align="start">
      <List spacing={3}>
        <ListItem>
          <ListIcon
            as={CheckCircleIcon}
            color={data?.project ? "green.500" : "gray.500"}
          />
          Sync your first message
        </ListItem>
        <ListItem>
          <ListIcon
            as={CheckCircleIcon}
            color={data?.checks ? "green.500" : "gray.500"}
          />
          Set up your first evaluation
        </ListItem>
        <ListItem>
          <ListIcon
            as={CheckCircleIcon}
            color={data?.triggers ? "green.500" : "gray.500"}
          />
          Set up an alert
        </ListItem>
        {/* You can also use custom icons from react-icons */}
        <ListItem>
          <ListIcon
            as={CheckCircleIcon}
            color={data?.datasets ? "green.500" : "gray.500"}
          />
          Create a dataset from the messages
        </ListItem>
        <ListItem>
          <ListIcon
            as={CheckCircleIcon}
            color={data?.customGraphs ? "green.500" : "gray.500"}
          />
          Create a custom dashboard
        </ListItem>
      </List>
    </VStack>
  );
};
