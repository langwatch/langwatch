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
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
  Textarea,
  Select,
  Input,
  Link,
  TableContainer,
  Container,
} from "@chakra-ui/react";
import type { TriggerAction } from "@prisma/client";
import { Bell, MoreVertical } from "react-feather";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { DeleteIcon, EditIcon } from "@chakra-ui/icons";
import { Switch } from "@chakra-ui/react";
import {
  DashboardLayout,
  ProjectSelector,
} from "../../components/DashboardLayout";
import { type AlertType } from "@prisma/client";
import {
  useForm,
  Controller,
  type SubmitHandler,
  type Control,
  type UseFormHandleSubmit,
} from "react-hook-form";
import { z } from "zod";
import { SmallLabel } from "~/components/SmallLabel";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";

export default function Members() {
  const { project, organizations } = useOrganizationTeamProject();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const triggers = api.trigger.getTriggers.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );

  const getDatasets = api.dataset.getAll.useQuery({
    projectId: project?.id ?? "",
  });

  const { setValue, ...formMethods } = useForm({
    defaultValues: {
      triggerId: "",
      customMessage: "",
      alertType: "INFO",
      name: "",
    },
  });

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

  const getDatasetName = (actionParams: ActionParams) => {
    if (actionParams.datasetId) {
      return (
        <Link href={`/${project?.slug}/datasets/${actionParams.datasetId}`}>
          View &quot;
          {
            getDatasets.data?.find(
              (dataset) => dataset.id === actionParams.datasetId
            )?.name
          }
          &quot;
        </Link>
      );
    }
    return "";
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
      case "ADD_TO_DATASET":
        return "Add to dataset";
    }
  };

  interface ActionParams {
    slackWebhook?: string;
    members?: string[];
    datasetId?: string;
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
      case "ADD_TO_DATASET":
        return getDatasetName(actionParams) ?? "";
    }
  };

  const handleCloseModal = () => {
    onClose();
    void triggers.refetch();
  };

  return (
    <DashboardLayout>
      <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
        <HStack width="full" align="top" spacing={6} paddingBottom={6}>
          <Heading size="lg" as="h1">
            Triggers
          </Heading>
          <Spacer />
          {organizations && project && (
            <ProjectSelector organizations={organizations} project={project} />
          )}
        </HStack>
        <Card width="full" padding={6}>
          <CardBody width="full" paddingY={0} paddingX={0}>
            {triggers.data && triggers.data.length == 0 ? (
              <NoDataInfoBlock
                title="No triggers yet"
                description="Set up triggers on your messages to get notified when certain conditions are met."
                docsInfo={
                  <Text>
                    To learn more about triggers, please visit our{" "}
                    <Link
                      color="orange.400"
                      href="https://docs.langwatch.ai/features/triggers"
                      target="_blank"
                    >
                      documentation
                    </Link>
                    .
                  </Text>
                }
                icon={<Bell />}
              />
            ) : (
              <TableContainer>
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
                                  handleToggleTrigger(
                                    trigger.id,
                                    !trigger.active
                                  );
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
                                    icon={<EditIcon />}
                                    onClick={() => {
                                      setValue("triggerId", trigger.id);
                                      setValue(
                                        "customMessage",
                                        trigger.message ?? ""
                                      );
                                      setValue(
                                        "alertType",
                                        trigger.alertType ?? ""
                                      );
                                      setValue("name", trigger.name ?? "");
                                      onOpen();
                                    }}
                                  >
                                    Customize
                                  </MenuItem>
                                  <MenuItem
                                    color="red.600"
                                    onClick={(event) => {
                                      event.stopPropagation();

                                      deleteTrigger(trigger.id);
                                    }}
                                    icon={<DeleteIcon />}
                                  >
                                    Delete
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
              </TableContainer>
            )}
          </CardBody>
        </Card>
      </Container>
      <Modal isOpen={isOpen} onClose={handleCloseModal} size="2xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Customize Your Trigger</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <TriggerForm
              control={
                formMethods.control as unknown as Control<TriggerFormData>
              }
              handleSubmit={
                formMethods.handleSubmit as unknown as UseFormHandleSubmit<TriggerFormData>
              }
              onClose={handleCloseModal}
            />
          </ModalBody>

          <ModalFooter></ModalFooter>
        </ModalContent>
      </Modal>
    </DashboardLayout>
  );
}

const triggerFormSchema = z.object({
  alertType: z.enum(["CRITICAL", "WARNING", "INFO", ""]),
  customMessage: z.string().optional(),
  triggerId: z.string(),
  name: z.string().optional(),
});

type TriggerFormData = z.infer<typeof triggerFormSchema>;

const TriggerForm = ({
  control,
  handleSubmit,
  onClose,
}: {
  control: Control<TriggerFormData>;
  handleSubmit: UseFormHandleSubmit<TriggerFormData>;
  onClose: () => void;
}) => {
  const addCustomMessageMutation = api.trigger.addCustomMessage.useMutation();
  const { project } = useOrganizationTeamProject();
  const toast = useToast();

  const onSubmit: SubmitHandler<TriggerFormData> = (data) => {
    addCustomMessageMutation.mutate(
      {
        triggerId: data.triggerId,
        message: data.customMessage ?? "",
        alertType: data.alertType as AlertType,
        projectId: project?.id ?? "",
        name: data.name ?? "",
      },
      {
        onSuccess: () => {
          toast({
            title: "Custom message",
            status: "success",
            description: "Custom message added",
            duration: 5000,
            isClosable: true,
          });
          onClose();
        },
        onError: () => {
          toast({
            title: "Custom message",
            status: "error",
            description: "Failed to add custom message",
            duration: 5000,
            isClosable: true,
          });
        },
      }
    );
  };

  return (
    //eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <VStack spacing={4} align="start" width="full">
        <Text>
          Create a customized message for this trigger. This will override the
          default message for this trigger.
        </Text>
        <VStack width="full" align="start">
          <SmallLabel>Title</SmallLabel>
          <Controller
            name="name"
            control={control}
            render={({ field }) => <Input {...field} />}
          />
        </VStack>
        <VStack width="full" align="start">
          <SmallLabel>Alert Type</SmallLabel>
          <Controller
            name="alertType"
            control={control}
            rules={{ required: "Alert type is required" }}
            render={({ field }) => (
              <Select {...field} placeholder="Select Alert Type">
                <option value="INFO">Info</option>
                <option value="WARNING">Warning</option>
                <option value="CRITICAL">Critical</option>
              </Select>
            )}
          />
        </VStack>
        <VStack width="full" align="start">
          <SmallLabel>Alert Message</SmallLabel>
          <Controller
            name="customMessage"
            control={control}
            render={({ field }) => (
              <Textarea {...field} placeholder="Your message" />
            )}
          />
        </VStack>
        <HStack width="full">
          <Spacer />
          <Button type="submit" colorScheme="orange">
            Save Trigger
          </Button>
        </HStack>
      </VStack>
    </form>
  );
};
