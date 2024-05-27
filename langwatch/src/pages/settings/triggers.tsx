import {
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  LinkBox,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { MoreVertical } from "react-feather";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

import { DeleteIcon } from "@chakra-ui/icons";
import { Switch } from "@chakra-ui/react";

export default function Members() {
  const { project } = useOrganizationTeamProject();
  const toast = useToast();

  const triggers = api.trigger.getTriggers.useQuery({
    projectId: project?.id ?? "",
  });

  console.log("triggers", triggers.data);

  const toggleTrigger = api.trigger.toggleTrigger.useMutation();
  const deleteTriggerMutation = api.trigger.deleteById.useMutation();

  const handleToggleTrigger = (triggerId: string, active: boolean) => {
    toggleTrigger.mutate(
      { triggerId, active, projectId: project?.id ?? "" },
      {
        onSuccess: () => {
          void triggers.refetch();
        },
        onError: () => {
          toast({
            title: "Update trigger",
            status: "error",
            description: "Failed to update trigger",
            duration: 6000,
            isClosable: true,
          });
        },
      }
    );
  };

  const deleteTrigger = (triggerId: string) => {
    deleteTriggerMutation.mutate(
      { triggerId, projectId: project?.id ?? "" },
      {
        onSuccess: () => {
          toast({
            title: "Delete trigger",
            status: "success",
            description: "Trigger deleted",
            duration: 5000,
            isClosable: true,
          });
          void triggers.refetch();
        },
        onError: () => {
          toast({
            title: "Delete trigger",
            status: "error",
            description: "Failed to delete trigger",
            duration: 5000,
            isClosable: true,
          });
        },
      }
    );
  };

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="1024px"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Triggers
          </Heading>
          <Spacer />
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={0} paddingX={0}>
            <Table variant="simple" width="full">
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Action</Th>
                  <Th>Emails</Th>
                  <Th>Last Triggered At</Th>
                  <Th>Active</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {/* {triggers.data?.map((trigger) => {
                  const lastRunAt = new Date(trigger.lastRunAt);
                  const lastRunAtFormatted = lastRunAt.toLocaleString();

                  return (
                    <Tr key={trigger.id}>
                      <Td>{trigger.name}</Td>
                      <Td>{trigger.action}</Td>
                      <Td>
                        {(
                          trigger.actionParams as { members: string[] }
                        ).members?.join(", ")}
                      </Td>

                      <Td whiteSpace="nowrap">{lastRunAtFormatted}</Td>
                      <Td textAlign="center">
                        <Switch
                          isChecked={trigger.active}
                          onChange={() => {
                            handleToggleTrigger(trigger.id, !trigger.active);
                          }}
                        />
                      </Td>
                      <Td>
                        <Menu>
                          <MenuButton
                            as={Button}
                            variant={"ghost"}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            <MoreVertical />
                          </MenuButton>
                          <MenuList>
                            <MenuItem
                              color="red.600"
                              onClick={(event) => {
                                event.stopPropagation();

                                deleteTrigger(trigger.id);
                              }}
                              icon={<DeleteIcon />}
                            >
                              Delete trigger
                            </MenuItem>
                          </MenuList>
                        </Menu>
                      </Td>
                    </Tr>
                  );
                })} */}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}
