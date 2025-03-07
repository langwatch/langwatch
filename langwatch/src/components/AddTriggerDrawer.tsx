import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Stack,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { TriggerAction } from "@prisma/client";
import { useDrawer } from "~/components/CurrentDrawer";

// Import from our UI components
import { Drawer } from "../components/ui/drawer";
import { Popover } from "../components/ui/popover";
import { Radio, RadioGroup } from "../components/ui/radio";
import { toaster } from "../components/ui/toaster";
import { Tooltip } from "../components/ui/tooltip";

import { useFilterParams } from "~/hooks/useFilterParams";
import { HorizontalFormControl } from "./HorizontalFormControl";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocalStorage } from "usehooks-ts";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "~/server/datasets/types";
import { api } from "~/utils/api";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import type {
  Mapping,
  MappingState,
  TRACE_EXPANSIONS,
} from "./datasets/DatasetMapping";
import { AddParticipants } from "~/components/traces/AddParticipants";
import { DatasetMappingPreview } from "./datasets/DatasetMappingPreview";
import { DatasetSelector } from "./datasets/DatasetSelector";

import { CheckSquare } from "react-feather";
import { AddAnnotationQueueDrawer } from "./AddAnnotationQueueDrawer";

export function TriggerDrawer() {
  const { project, organization, team } = useOrganizationTeamProject();
  const { onOpen, onClose, open } = useDisclosure();

  const publicEnv = usePublicEnv();
  const hasEmailProvider = publicEnv.data?.HAS_EMAIL_PROVIDER_KEY;

  const createTrigger = api.trigger.create.useMutation();
  const teamSlug = team?.slug;
  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchOnWindowFocus: false }
  );

  const teamWithMembers = api.team.getTeamWithMembers.useQuery(
    {
      slug: teamSlug ?? "",
      organizationId: organization?.id ?? "",
    },
    { enabled: typeof teamSlug === "string" && !!organization?.id }
  );

  const [annotators, setAnnotators] = useState<{ id: string; name: string }[]>(
    []
  );

  const { closeDrawer } = useDrawer();
  const { filterParams } = useFilterParams();
  const queueDrawerOpen = useDisclosure();

  const [localStorageDatasetId, setLocalStorageDatasetId] =
    useLocalStorage<string>("selectedDatasetId", "");

  type FormValues = {
    name: string;
    action: TriggerAction;
    email: string;
    members: string[];
    slackWebhook: string;
    datasetId: string;
  };

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
    setValue,
  } = useForm<FormValues>({
    defaultValues: {
      name: "",
      action: TriggerAction.SEND_SLACK_MESSAGE,
      email: "",
      members: [],
      slackWebhook: "",
      datasetId: localStorageDatasetId,
    },
    mode: "onChange",
  });

  const datasetId = watch("datasetId");

  const selectedDataset = datasets.data?.find(
    (dataset) => dataset.id === datasetId
  );

  const tracesWithSpans = api.traces.getSampleTracesDataset.useQuery(
    {
      ...filterParams,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );

  useEffect(() => {
    if (datasetId) {
      setLocalStorageDatasetId(datasetId);
    }
  }, [datasetId, setLocalStorageDatasetId]);

  const currentAction: TriggerAction = watch("action");

  const onCreateDatasetSuccess = ({ datasetId }: { datasetId: string }) => {
    editDataset.onClose();
    void datasets.refetch().then(() => {
      setTimeout(() => {
        setValue("datasetId", datasetId);
      }, 100);
    });
  };

  const [rowDataFromDataset, setRowDataFromDataset] = useState<
    DatasetRecordEntry[]
  >([]);

  const [datasetTriggerMapping, setDatasetTriggerMapping] =
    useState<MappingState>({
      mapping: {},
      expansions: new Set(),
    });

  type Trigger = {
    name: string;
    action: TriggerAction;
    email?: string;
    members?: string[];
    slackWebhook?: string;
  };

  type ActionParams = {
    members?: string[];
    slackWebhook?: string;
    datasetId?: string;
    annotators?: { id: string; name: string }[];
    datasetMapping?:
      | {
          mapping: Mapping;
          expansions: Set<keyof typeof TRACE_EXPANSIONS> | undefined;
        }
      | undefined;
  };

  const onSubmit = (data: Trigger) => {
    let actionParams: ActionParams = {
      members: [],
      slackWebhook: "",
      datasetId: datasetId,
      datasetMapping: datasetTriggerMapping,
      annotators: annotators,
    };
    if (data.action === TriggerAction.SEND_EMAIL) {
      actionParams = {
        members: data.members ?? [],
      };
    } else if (data.action === TriggerAction.SEND_SLACK_MESSAGE) {
      actionParams = {
        slackWebhook: data.slackWebhook ?? "",
      };
    } else if (data.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE) {
      actionParams = {
        annotators: annotators,
      };
    } else if (data.action === TriggerAction.ADD_TO_DATASET) {
      actionParams = {
        datasetId: datasetId,
        datasetMapping: datasetTriggerMapping,
      };
    }

    createTrigger.mutate(
      {
        projectId: project?.id ?? "",
        name: data.name,
        action: data.action,
        filters: filterParams.filters,
        actionParams: {
          ...actionParams,
          datasetMapping: actionParams.datasetMapping
            ? {
                mapping: actionParams.datasetMapping.mapping,
                expansions: Array.from(
                  actionParams.datasetMapping.expansions ?? []
                ),
              }
            : undefined,
        },
      },
      {
        onSuccess: () => {
          toaster.create({
            title: "Trigger Created",
            description: "You have successfully created a trigger",
            type: "success",
            placement: "top-end",
            meta: {
              closable: true,
            },
          });
          reset();
          closeDrawer();
        },
        onError: () => {
          toaster.create({
            title: "Error",
            description: "Error creating trigger",
            type: "error",
            placement: "top-end",
            meta: {
              closable: true,
            },
          });
        },
      }
    );
  };

  const MultiSelect = () => {
    const formMembers = watch("members") || [];
    const [selectedMembers, setSelectedMembers] =
      useState<string[]>(formMembers);

    const handlePopoverChange = ({ open }: { open: boolean }) => {
      if (open) {
        onOpen();
      } else {
        setValue("members", selectedMembers);
        onClose();
      }
    };

    return (
      <VStack width="full" align="start">
        <Popover.Root
          positioning={{ placement: "bottom" }}
          open={open}
          onOpenChange={handlePopoverChange}
        >
          <Popover.Trigger width={"full"}>
            <Field.Root width="100%">
              <Input
                placeholder="Select email/s"
                defaultValue={selectedMembers}
                value={selectedMembers.join(", ")}
                readOnly
                required
                {...register("members")}
                width="100%"
              />
            </Field.Root>
          </Popover.Trigger>
          <Popover.Content marginTop="-8px">
            <Popover.CloseTrigger onClick={onClose} zIndex={1000} />
            <Popover.Body>
              <VStack width="full" align="start">
                {teamWithMembers.data?.members.map((member) => {
                  const email = member.user.email ?? "";
                  return (
                    <HStack
                      key={member.user.id}
                      cursor="pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        const email = member.user.email ?? "";
                        if (selectedMembers.includes(email)) {
                          setSelectedMembers(
                            selectedMembers.filter((m) => m !== email)
                          );
                        } else {
                          setSelectedMembers([...selectedMembers, email]);
                        }
                      }}
                    >
                      <CheckSquare
                        width={18}
                        color={
                          selectedMembers.includes(email) ? "green" : "gray"
                        }
                      />
                      <Box key={member.user.id}>{member.user.email}</Box>
                    </HStack>
                  );
                })}
              </VStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Root>
      </VStack>
    );
  };

  const editDataset = useDisclosure();

  return (
    <Drawer.Root
      open={true}
      onOpenChange={({ open }) => !open && closeDrawer()}
      placement="end"
    >
      <Drawer.Backdrop />
      <Drawer.Content maxWidth="1200px">
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Add Trigger
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <HorizontalFormControl
              label="Name"
              helper="Give it a name that identifies what trigger it might be"
              invalid={!!errors.name}
            >
              <Input
                placeholder="Evaluation trigger"
                required
                {...register("name")}
              />
              <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Action"
              helper="Select action you would like to take once a your trigger has taken place."
              minWidth="calc(50% - 16px)"
            >
              <RadioGroup {...register("action")}>
                <Stack gap={4}>
                  <VStack align="start">
                    <Radio
                      value={TriggerAction.SEND_SLACK_MESSAGE}
                      colorPalette="blue"
                      alignItems="start"
                      gap={3}
                      {...register("action")}
                      paddingTop={2}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">Send Slack Message</Text>
                        <Text fontSize="13px" fontWeight="normal">
                          Add your slack webhook url to send a message to when
                          the trigger is activated.
                        </Text>
                      </VStack>
                    </Radio>
                    {currentAction === TriggerAction.SEND_SLACK_MESSAGE && (
                      <Input
                        placeholder="Your slack hook url"
                        required
                        {...register("slackWebhook")}
                      />
                    )}
                  </VStack>
                  <Tooltip
                    content="Add a SendGrid API key or AWS SES credentials(Only if you are using AWS SES) to your environment variables to enable email functionality."
                    positioning={{ placement: "top" }}
                    showArrow
                    disabled={hasEmailProvider}
                  >
                    <VStack align="start" width="full">
                      <Radio
                        value={TriggerAction.SEND_EMAIL}
                        colorPalette="blue"
                        alignItems="start"
                        gap={3}
                        {...register("action")}
                        paddingTop={2}
                        disabled={!hasEmailProvider}
                      >
                        <Text fontWeight="500">Email</Text>
                        <Text fontSize="13px" fontWeight="normal">
                          Receive an email with the details and the items that
                          triggered the alert.
                        </Text>
                      </Radio>

                      {currentAction === TriggerAction.SEND_EMAIL && (
                        <MultiSelect />
                      )}
                    </VStack>
                  </Tooltip>

                  <VStack align="start">
                    <Radio
                      value={TriggerAction.ADD_TO_ANNOTATION_QUEUE}
                      colorPalette="blue"
                      alignItems="start"
                      gap={3}
                      paddingTop={2}
                      {...register("action")}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">Add to Annotation Queue</Text>
                        <Text fontSize="13px" fontWeight="normal">
                          Add entries to the annotation queue, this allows you
                          to keep track of the results of your triggers.
                        </Text>
                      </VStack>
                    </Radio>
                  </VStack>
                  {currentAction === TriggerAction.ADD_TO_ANNOTATION_QUEUE && (
                    <Box>
                      <AddParticipants
                        annotators={annotators}
                        setAnnotators={setAnnotators}
                        queueDrawerOpen={queueDrawerOpen}
                        isTrigger={true}
                      />
                    </Box>
                  )}
                  <VStack align="start">
                    <Radio
                      value={TriggerAction.ADD_TO_DATASET}
                      colorPalette="blue"
                      alignItems="start"
                      gap={3}
                      paddingTop={2}
                      {...register("action")}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">Add to Dataset</Text>
                        <Text fontSize="13px" fontWeight="normal">
                          Add entries to the dataset, this allows you to keep
                          track of the results of your triggers.
                        </Text>
                      </VStack>
                    </Radio>
                  </VStack>
                </Stack>
              </RadioGroup>
            </HorizontalFormControl>

            {currentAction === TriggerAction.ADD_TO_DATASET && (
              <>
                <DatasetSelector
                  datasets={datasets.data}
                  localStorageDatasetId={localStorageDatasetId}
                  register={register}
                  errors={errors}
                  setValue={setValue}
                  onCreateNew={editDataset.onOpen}
                />
                {selectedDataset && (
                  <DatasetMappingPreview
                    traces={tracesWithSpans.data ?? []}
                    columnTypes={selectedDataset.columnTypes as DatasetColumns}
                    selectedDataset={selectedDataset}
                    rowData={rowDataFromDataset}
                    onEditColumns={editDataset.onOpen}
                    onRowDataChange={setRowDataFromDataset}
                    paragraph="This is a sample of the data will look when added to the dataset."
                    setDatasetTriggerMapping={setDatasetTriggerMapping}
                  />
                )}
              </>
            )}

            <HStack justifyContent="flex-end" paddingTop={4}>
              <Button
                colorPalette="blue"
                type="submit"
                minWidth="fit-content"
                loading={createTrigger.isLoading}
              >
                Add Trigger
              </Button>
            </HStack>
          </form>
        </Drawer.Body>
      </Drawer.Content>
      <AddOrEditDatasetDrawer
        datasetToSave={
          selectedDataset
            ? {
                datasetId,
                name: selectedDataset?.name ?? "",
                datasetRecords: undefined,
                columnTypes:
                  (selectedDataset?.columnTypes as DatasetColumns) ?? [],
              }
            : undefined
        }
        open={editDataset.open}
        onClose={editDataset.onClose}
        onSuccess={onCreateDatasetSuccess}
      />
      <AddAnnotationQueueDrawer
        open={queueDrawerOpen.open}
        onClose={queueDrawerOpen.onClose}
        onOverlayClick={queueDrawerOpen.onClose}
      />
    </Drawer.Root>
  );
}
