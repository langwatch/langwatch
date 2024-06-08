import {
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
  useToast,
} from "@chakra-ui/react";
import type { TriggerAction } from "@prisma/client";
import { MoreVertical } from "react-feather";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { DeleteIcon } from "@chakra-ui/icons";
import { Switch } from "@chakra-ui/react";
import { ProjectSelector } from "../../components/DashboardLayout";

export default function Members() {
  const { project, organizations } = useOrganizationTeamProject();
  const toast = useToast();

  const triggers = api.trigger.getTriggers.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );

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

  const triggerActionName = (action: TriggerAction) => {
    switch (action) {
      case "SEND_SLACK_MESSAGE":
        return "Slack";
      case "SEND_EMAIL":
        return "Email";
    }
  };

  interface ActionParams {
    slackWebhook?: string;
    members?: string[];
  }

  const actionItems = (action: TriggerAction, actionParams: ActionParams) => {
    switch (action) {
      case "SEND_SLACK_MESSAGE":
        return (
          <Tooltip
            label={(actionParams as { slackWebhook: string }).slackWebhook}
          >
            <Text noOfLines={1} display="block">
              Webhook
            </Text>
          </Tooltip>
        );
      case "SEND_EMAIL":
        return (actionParams as { members: string[] }).members?.join(", ");
    }
  };

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="6xl"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Triggers
          </Heading>
          <Spacer />
          {organizations && project && (
            <ProjectSelector organizations={organizations} project={project} />
          )}
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={0} paddingX={0}>
            <Table variant="simple" width="full">
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Action</Th>
                  <Th>Action Items</Th>
                  <Th>Checks</Th>
                  <Th>Last Triggered At</Th>
                  <Th>Active</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {triggers.isLoading ? (
                  <Tr>
                    <Td colSpan={5}>Loading...</Td>
                  </Tr>
                ) : triggers.data?.length === 0 ? (
                  <Tr>
                    <Td colSpan={5}>
                      No triggers, set one up by creating a filter on your
                      messages.
                    </Td>
                  </Tr>
                ) : (
                  triggers.data?.map((trigger) => {
                    const lastRunAt = new Date(trigger.lastRunAt);
                    const lastRunAtFormatted = lastRunAt.toLocaleString();

                    return (
                      <Tr key={trigger.id}>
                        <Td>{trigger.name}</Td>
                        <Td>{triggerActionName(trigger.action)}</Td>
                        <Td>
                          {actionItems(
                            trigger.action,
                            trigger.actionParams as ActionParams
                          )}
                        </Td>
                        <Td>
                          <Tooltip
                            label={trigger.checks
                              .map((check) => check?.name)
                              .join(", ")}
                          >
                            <Text noOfLines={1} display="block">
                              {trigger.checks
                                .map((check) => check?.name)
                                .join(", ")}
                            </Text>
                          </Tooltip>
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
                  })
                )}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}
