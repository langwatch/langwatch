import {
  Box,
  Button,
  Card,
  Container,
  Heading,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Table,
  Text,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { AlertType, Monitor, TriggerAction } from "@prisma/client";
import { Bell, Edit2, Filter, MoreVertical, Trash } from "react-feather";
import {
  type Control,
  Controller,
  type SubmitHandler,
  type UseFormHandleSubmit,
  useForm,
} from "react-hook-form";
import { z } from "zod";
import { HoverableBigText } from "~/components/HoverableBigText";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { SmallLabel } from "~/components/SmallLabel";
import { FilterDisplay } from "~/components/automations/FilterDisplay";
import { useDrawer } from "~/hooks/useDrawer";
import { ProjectSelector } from "../../components/DashboardLayout";
import SettingsLayout from "../../components/SettingsLayout";
import { Drawer } from "../../components/ui/drawer";
import { Link } from "../../components/ui/link";
import { Menu } from "../../components/ui/menu";
import { Switch } from "../../components/ui/switch";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { formatTimeAgo } from "../../utils/formatTimeAgo";

function Automations() {
  const { project, organizations } = useOrganizationTeamProject();
  const { open, onOpen, onClose } = useDisclosure();
  const { openDrawer } = useDrawer();

  const triggers = api.automation.getTriggers.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    },
  );

  const getDatasets = api.dataset.getAll.useQuery({
    projectId: project?.id ?? "",
  });

  const { setValue, ...formMethods } = useForm({
    defaultValues: {
      triggerId: "",
      customMessage: "",
      alertType: "",
      name: "",
    },
  });

  const toggleTrigger = api.automation.toggleTrigger.useMutation();
  const deleteTriggerMutation = api.automation.deleteById.useMutation();

  const handleToggleTrigger = (triggerId: string, active: boolean) => {
    toggleTrigger.mutate(
      { triggerId, active, projectId: project?.id ?? "" },
      {
        onSuccess: () => {
          void triggers.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Update automation",
            type: "error",
            description: "Failed to update automation",
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  const getDatasetName = (actionParams: ActionParams) => {
    if (actionParams.datasetId) {
      return (
        <Link href={`/${project?.slug}/datasets/${actionParams.datasetId}`}>
          {
            getDatasets.data?.find(
              (dataset) => dataset.id === actionParams.datasetId,
            )?.name
          }
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
          toaster.create({
            title: "Delete automation",
            type: "success",
            description: "Automation deleted",
            meta: {
              closable: true,
            },
          });
          void triggers.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Delete automation",
            type: "error",
            description: "Failed to delete automation",
            meta: {
              closable: true,
            },
          });
        },
      },
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
      case "ADD_TO_ANNOTATION_QUEUE":
        return "Add to annotation queue";
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
            content={(actionParams as { slackWebhook: string }).slackWebhook}
          >
            <Text lineClamp={1} display="block">
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

  const FilterContainer = ({
    children,
    fontSize = "sm",
  }: {
    children: React.ReactNode;
    fontSize?: string;
  }) => (
    <HStack
      border="1px solid lightgray"
      borderRadius="4px"
      fontSize={fontSize}
      width="100%"
      gap={2}
      paddingX={2}
      paddingY={1}
    >
      <Box color="fg.muted">
        <Filter width={16} style={{ minWidth: 16 }} />
      </Box>
      {children}
    </HStack>
  );

  const FilterLabel = ({ children }: { children: React.ReactNode }) => {
    const text = String(children)
      .split(".")
      .filter(
        (word, index) => index !== 0 || word.toLowerCase() === "evaluations",
      )
      .join(" ");

    return (
      <Box
        padding={1}
        fontWeight="500"
        textTransform="capitalize"
        color="fg.muted"
      >
        {text.replace("_", " ")}
      </Box>
    );
  };

  const FilterValue = ({ children }: { children: React.ReactNode }) => {
    return (
      <Box padding={1} borderRightRadius="md">
        <HoverableBigText lineClamp={1} expandable={false}>
          {children}
        </HoverableBigText>
      </Box>
    );
  };

  const applyChecks = (checks: Monitor[]) => {
    if (!checks || checks.length === 0) {
      return null;
    }

    return (
      <FilterContainer fontSize="sm">
        <FilterLabel>Evaluations</FilterLabel>
        <FilterValue>
          {checks.map((check) => check?.name).join(", ")}
        </FilterValue>
      </FilterContainer>
    );
  };

  return (
    <SettingsLayout>
      <Container maxWidth="1280px" padding={4}>
        <HStack width="full" align="top" gap={6} paddingBottom={6}>
          <Heading>Automations</Heading>
          <Spacer />
          {organizations && project && (
            <ProjectSelector organizations={organizations} project={project} />
          )}
        </HStack>
        {triggers.data && triggers.data.length == 0 ? (
          <NoDataInfoBlock
            title="No automations yet"
            description="Set up automations on your messages to get notified when certain conditions are met."
            docsInfo={
              <Text>
                To learn more about automations, please visit our{" "}
                <Link
                  color="orange.400"
                  href="https://docs.langwatch.ai/features/automations"
                  isExternal
                >
                  documentation
                </Link>
                .
              </Text>
            }
            icon={<Bell />}
          />
        ) : (
          <VStack align="stretch" gap={4}>
            <Box
              border="1px solid"
              borderColor="gray.200"
              borderRadius="lg"
              overflow="hidden"
            >
              <Table.Root variant="line" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Action</Table.ColumnHeader>
                  <Table.ColumnHeader>Destination</Table.ColumnHeader>
                  <Table.ColumnHeader>Filters</Table.ColumnHeader>
                  <Table.ColumnHeader whiteSpace="nowrap">
                    Last Triggered At
                  </Table.ColumnHeader>
                  <Table.ColumnHeader>Active</Table.ColumnHeader>
                  <Table.ColumnHeader>Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
              {triggers.isLoading ? (
                <Table.Row>
                  <Table.Cell colSpan={5}>Loading...</Table.Cell>
                </Table.Row>
              ) : (
                triggers.data?.map((trigger) => {
                  return (
                    <Table.Row key={trigger.id} data-trigger-id={trigger.id}>
                      <Table.Cell>{trigger.name}</Table.Cell>
                      <Table.Cell>
                        {triggerActionName(trigger.action)}
                      </Table.Cell>
                      <Table.Cell>
                        {actionItems(
                          trigger.action,
                          trigger.actionParams as ActionParams,
                        )}
                      </Table.Cell>

                      <Table.Cell maxWidth="500px">
                        <VStack gap={2}>
                          {applyChecks(
                            trigger.checks?.filter(
                              (check): check is Monitor => !!check,
                            ) ?? [],
                          )}

                          {trigger.filters &&
                          typeof trigger.filters === "string" ? (
                            <FilterDisplay
                              filters={trigger.filters}
                              hasBorder={true}
                            />
                          ) : null}
                        </VStack>
                      </Table.Cell>
                      <Table.Cell whiteSpace="nowrap">
                        {formatTimeAgo(trigger.lastRunAt)}
                      </Table.Cell>
                      <Table.Cell textAlign="center">
                        <Switch
                          checked={trigger.active}
                          onChange={() => {
                            handleToggleTrigger(trigger.id, !trigger.active);
                          }}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <Button
                              variant={"ghost"}
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                            >
                              <MoreVertical />
                            </Button>
                          </Menu.Trigger>
                          <Menu.Content>
                            {trigger.action != "ADD_TO_DATASET" && (
                              <Menu.Item
                                value="customize"
                                onClick={() => {
                                  setValue("triggerId", trigger.id);
                                  setValue(
                                    "customMessage",
                                    trigger.message ?? "",
                                  );
                                  setValue(
                                    "alertType",
                                    trigger.alertType ?? "",
                                  );
                                  setValue("name", trigger.name ?? "");
                                  onOpen();
                                }}
                              >
                                <Box display="flex" alignItems="center" gap={2}>
                                  <Edit2 size={14} />
                                  Customize Message
                                </Box>
                              </Menu.Item>
                            )}
                            <Menu.Item
                              value="edit"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDrawer("editAutomationFilter", {
                                  automationId: trigger.id,
                                });
                              }}
                            >
                              <Box display="flex" alignItems="center" gap={2}>
                                <Filter size={14} />
                                Edit Filters
                              </Box>
                            </Menu.Item>
                            <Menu.Item
                              value="delete"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteTrigger(trigger.id);
                              }}
                            >
                              <Box
                                display="flex"
                                alignItems="center"
                                gap={2}
                                color="red.600"
                              >
                                <Trash size={14} />
                                Delete
                              </Box>
                            </Menu.Item>
                          </Menu.Content>
                        </Menu.Root>
                      </Table.Cell>
                    </Table.Row>
                  );
                })
              )}
              </Table.Body>
            </Table.Root>
            </Box>
            <Text fontSize="sm" color="fg.muted">
              Learn more about creating automations on our{" "}
              <Link
                color="orange.400"
                href="https://langwatch.ai/docs/features/automations#create-automations-based-on-langwatch-filters"
                isExternal
              >
                docs
              </Link>
              .
            </Text>
          </VStack>
        )}
      </Container>
      <Drawer.Root
        open={open}
        onOpenChange={({ open }) => (open ? onOpen() : handleCloseModal())}
        size="lg"
      >
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Alert Message</Drawer.Title>
          </Drawer.Header>
          <Drawer.CloseTrigger />
          <Drawer.Body>
            <TriggerForm
              control={
                formMethods.control as unknown as Control<TriggerFormData>
              }
              handleSubmit={
                formMethods.handleSubmit as unknown as UseFormHandleSubmit<TriggerFormData>
              }
              onClose={handleCloseModal}
            />
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    </SettingsLayout>
  );
}

export default withPermissionGuard("triggers:view", {
  layoutComponent: SettingsLayout,
})(Automations);

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
  const addCustomMessageMutation = api.automation.addCustomMessage.useMutation();
  const { project } = useOrganizationTeamProject();

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
          toaster.create({
            title: "Custom message",
            type: "success",
            description: "Custom message added",
            meta: {
              closable: true,
            },
          });
          onClose();
        },
        onError: () => {
          toaster.create({
            title: "Custom message",
            type: "error",
            description: "Failed to add custom message",
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  return (
    //eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <VStack gap={4} align="start" width="full">
        <Text>
          Customize the notification message that will be sent when this automation
          activates. This will replace the default message.
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
            render={({ field }) => (
              <NativeSelect.Root>
                <NativeSelect.Field {...field} placeholder="Select Alert Type">
                  <option value="INFO">Info</option>
                  <option value="WARNING">Warning</option>
                  <option value="CRITICAL">Critical</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
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
          <Button type="submit" colorPalette="orange">
            Save Automation
          </Button>
        </HStack>
      </VStack>
    </form>
  );
};
