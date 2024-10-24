import { VStack, Heading, List, ListIcon, ListItem } from "@chakra-ui/react";
import { CheckCircleIcon } from "@chakra-ui/icons";
import { CheckCircle, Settings, Circle } from "react-feather";
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
          <ListIcon as={CheckCircleIcon} color={"green.500"} />
          Create first project
        </ListItem>
        <ListItem>
          <ListIcon
            as={data?.project ? CheckCircleIcon : Circle}
            color={data?.project ? "green.500" : "gray.500"}
          />
          Sync your first message
        </ListItem>
        <ListItem>
          <ListIcon
            as={data?.checks ? CheckCircleIcon : Circle}
            color={data?.checks ? "green.500" : "gray.500"}
          />
          Set up your first evaluation
        </ListItem>
        <ListItem>
          <ListIcon
            as={data?.triggers ? CheckCircleIcon : Circle}
            color={data?.triggers ? "green.500" : "gray.500"}
          />
          Set up an alert
        </ListItem>
        {/* You can also use custom icons from react-icons */}
        <ListItem>
          <ListIcon
            as={data?.datasets ? CheckCircleIcon : Circle}
            color={data?.datasets ? "green.500" : "gray.500"}
          />
          Create a dataset from the messages
        </ListItem>
        <ListItem>
          <ListIcon
            as={data?.customGraphs ? CheckCircleIcon : Circle}
            color={data?.customGraphs ? "green.500" : "gray.500"}
          />
          Create a custom dashboard
        </ListItem>
      </List>
    </VStack>
  );
};
