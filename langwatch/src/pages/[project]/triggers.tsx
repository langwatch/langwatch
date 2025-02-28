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
import type { Check, TriggerAction } from "@prisma/client";
import { type AlertType } from "@prisma/client";
import { Bell, Edit2, Filter, MoreVertical, Trash } from "react-feather";
import {
  Controller,
  useForm,
  type Control,
  type SubmitHandler,
  type UseFormHandleSubmit,
} from "react-hook-form";
import { z } from "zod";
import { useDrawer } from "~/components/CurrentDrawer";
import { HoverableBigText } from "~/components/HoverableBigText";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { SmallLabel } from "~/components/SmallLabel";
import {
  DashboardLayout,
  ProjectSelector,
} from "../../components/DashboardLayout";
import { Drawer } from "../../components/ui/drawer";
import { Link } from "../../components/ui/link";
import { Menu } from "../../components/ui/menu";
import { Switch } from "../../components/ui/switch";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { formatTimeAgo } from "../../utils/formatTimeAgo";

export default function Members() {
  const { project, organizations } = useOrganizationTeamProject();
  const { open, onOpen, onClose } = useDisclosure();
  const { openDrawer } = useDrawer();

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
      alertType: "",
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
          toaster.create({
            title: "Update trigger",
            type: "error",
            description: "Failed to update trigger",
            placement: "top-end",
            meta: {
              closable: true,
            },
          });
        },
      }
    );
  };

  const getDatasetName = (actionParams: ActionParams) => {
    if (actionParams.datasetId) {
      return (
        <Link href={`/${project?.slug}/datasets/${actionParams.datasetId}`}>
          {
            getDatasets.data?.find(
              (dataset) => dataset.id === actionParams.datasetId
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
            title: "Delete trigger",
            type: "success",
            description: "Trigger deleted",
            placement: "top-end",
            meta: {
              closable: true,
            },
          });
          void triggers.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Delete trigger",
            type: "error",
            description: "Failed to delete trigger",
            placement: "top-end",
            meta: {
              closable: true,
            },
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
      <Box color="gray.500">
        <Filter width={16} style={{ minWidth: 16 }} />
      </Box>
      {children}
    </HStack>
  );

  const FilterLabel = ({ children }: { children: React.ReactNode }) => {
    const text = String(children)
      .split(".")
      .filter(
        (word, index) => index !== 0 || word.toLowerCase() === "evaluations"
      )
      .join(" ");

    return (
      <Box
        padding={1}
        fontWeight="500"
        textTransform="capitalize"
        color="gray.500"
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

  const applyFilters = (filters: string) => {
    const obj = JSON.parse(filters);
    const result = [];

    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        if (!key.startsWith("eval")) {
          result.push(
            <FilterContainer key={key}>
              <FilterLabel>{key}</FilterLabel>
              <FilterValue>{value.join(", ")}</FilterValue>
            </FilterContainer>
          );
        }
      } else if (typeof value === "object" && value !== null) {
        const nestedResult = [];
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          if (Array.isArray(nestedValue)) {
            nestedResult.push(`${nestedKey}:${nestedValue.join("-")}`);
          } else {
            nestedResult.push(`${nestedKey}:${nestedValue}`);
          }
        }
        if (!key.startsWith("eval")) {
          result.push(
            <FilterContainer key={key}>
              <FilterLabel>{key}</FilterLabel>
              <FilterValue>{nestedResult}</FilterValue>
            </FilterContainer>
          );
        }
      } else {
        result.push(
          <FilterContainer key={key} fontSize="xs">
            <FilterLabel>{key}</FilterLabel>
            <FilterValue>{String(value)}</FilterValue>
          </FilterContainer>
        );
      }
    }

    return result;
  };

  const applyChecks = (checks: Check[]) => {
    if (!checks || checks.length === 0) {
      return null;
    }

    return (
      <FilterContainer fontSize="sm">
        <FilterLabel>Evaluations</FilterLabel>
        <FilterValue>
          {checks.map((check, index) => check?.name).join(", ")}
        </FilterValue>
      </FilterContainer>
    );
  };

  return (
    <DashboardLayout>
      <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
        <HStack width="full" align="top" gap={6} paddingBottom={6}>
          <Heading size="lg" as="h1">
            Triggers
          </Heading>
          <Spacer />
          {organizations && project && (
            <ProjectSelector organizations={organizations} project={project} />
          )}
        </HStack>
        <Card.Root width="full" padding={6}>
          <Card.Body width="full" paddingY={0} paddingX={0}>
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
              <Table.Root variant="line" width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Name</Table.ColumnHeader>
                    <Table.ColumnHeader>Action</Table.ColumnHeader>
                    <Table.ColumnHeader>Destination</Table.ColumnHeader>
                    <Table.ColumnHeader>Filters</Table.ColumnHeader>
                    <Table.ColumnHeader>Last Triggered At</Table.ColumnHeader>
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
                        <Table.Row
                          key={trigger.id}
                          data-trigger-id={trigger.id}
                        >
                          <Table.Cell>{trigger.name}</Table.Cell>
                          <Table.Cell>
                            {triggerActionName(trigger.action)}
                          </Table.Cell>
                          <Table.Cell>
                            {actionItems(
                              trigger.action,
                              trigger.actionParams as ActionParams
                            )}
                          </Table.Cell>

                          <Table.Cell maxWidth="500px">
                            <VStack gap={2}>
                              {applyChecks(
                                trigger.checks?.filter(
                                  (check): check is Check => !!check
                                ) ?? []
                              )}

                              {trigger.filters &&
                              typeof trigger.filters === "string"
                                ? applyFilters(trigger.filters)
                                : null}
                            </VStack>
                          </Table.Cell>
                          <Table.Cell whiteSpace="nowrap">
                            {formatTimeAgo(trigger.lastRunAt)}
                          </Table.Cell>
                          <Table.Cell textAlign="center">
                            <Switch
                              checked={trigger.active}
                              onChange={() => {
                                handleToggleTrigger(
                                  trigger.id,
                                  !trigger.active
                                );
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
                                    <Box
                                      display="flex"
                                      alignItems="center"
                                      gap={2}
                                    >
                                      <Edit2 size={14} />
                                      Customize Message
                                    </Box>
                                  </Menu.Item>
                                )}
                                <Menu.Item
                                  value="edit"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openDrawer("editTriggerFilter", {
                                      triggerId: trigger.id,
                                    });
                                  }}
                                >
                                  <Box
                                    display="flex"
                                    alignItems="center"
                                    gap={2}
                                  >
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
            )}
          </Card.Body>
        </Card.Root>
      </Container>
      <Drawer.Root
        open={open}
        onOpenChange={({ open }) => (open ? onOpen() : handleCloseModal())}
        size="lg"
      >
        <Drawer.Backdrop />
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Trigger Message</Drawer.Title>
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
            placement: "top-end",
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
            placement: "top-end",
            meta: {
              closable: true,
            },
          });
        },
      }
    );
  };

  return (
    //eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <VStack gap={4} align="start" width="full">
        <Text>
          Customize the notification message that will be sent when this trigger
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
            Save Trigger
          </Button>
        </HStack>
      </VStack>
    </form>
  );
};
