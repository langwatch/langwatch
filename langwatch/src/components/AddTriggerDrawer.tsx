import {
  Button,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormErrorMessage,
  HStack,
  Input,
  Popover,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverTrigger,
  Radio,
  RadioGroup,
  Stack,
  Text,
  Tooltip,
  VStack,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { TriggerAction } from "@prisma/client";
import { useDrawer } from "~/components/CurrentDrawer";

import { HorizontalFormControl } from "./HorizontalFormControl";

import { useFilterParams } from "~/hooks/useFilterParams";

import { useForm } from "react-hook-form";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { DatasetSelector } from "./datasets/DatasetSelector";
import { useLocalStorage } from "usehooks-ts";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "~/server/datasets/types";
import { useEffect, useMemo, useState } from "react";
import { DatasetMappingPreview } from "./datasets/DatasetMappingPreview";
import {
  HeaderCheckboxComponent,
  type DatasetColumnDef,
} from "./datasets/DatasetGrid";
import type { CustomCellRendererProps } from "@ag-grid-community/react";
import type { Mapping } from "./datasets/DatasetMapping";

export function TriggerDrawer() {
  const { project, organization, team } = useOrganizationTeamProject();
  const { onOpen, onClose, isOpen } = useDisclosure();

  const publicEnv = usePublicEnv();
  const hasEmailProvider = publicEnv.data?.HAS_EMAIL_PROVIDER_KEY;

  const toast = useToast();
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

  const { closeDrawer } = useDrawer();

  const { filterParams } = useFilterParams();

  const [localStorageDatasetId, setLocalStorageDatasetId] =
    useLocalStorage<string>("selectedDatasetId", "");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
    setValue,
  } = useForm({
    defaultValues: {
      name: "",
      action: TriggerAction.SEND_EMAIL,
      email: "",
      members: [],
      slackWebhook: "",
      datasetId: localStorageDatasetId,
    },
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

  const columnDefs = useMemo(() => {
    if (!selectedDataset) {
      return [];
    }

    const headers: DatasetColumnDef[] = (
      (selectedDataset.columnTypes as DatasetColumns) ?? []
    ).map(({ name, type }) => ({
      headerName: name,
      field: name,
      type_: type,
      cellClass: "v-align",
      sortable: false,
      minWidth: ["trace_id", "total_cost"].includes(name)
        ? 120
        : ["timestamp"].includes(name)
        ? 160
        : 200,
    }));

    // Add row number column
    headers.unshift({
      headerName: " ",
      field: "selected",
      type_: "boolean",
      width: 46,
      pinned: "left",
      sortable: false,
      filter: false,
      enableCellChangeFlash: false,
      headerComponent: HeaderCheckboxComponent,
      cellRenderer: (props: CustomCellRendererProps) => (
        <Checkbox
          marginLeft="3px"
          {...props}
          isChecked={props.value}
          onChange={(e) => props.setValue?.(e.target.checked)}
        />
      ),
    });

    return headers;
  }, [selectedDataset]);

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

  const [datasetMapping] = useLocalStorage<{
    mapping: Mapping;
    expansions: string[];
  }>("datasetMapping", {
    mapping: {},
    expansions: [],
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
    datasetMapping?: {
      mapping: Mapping;
      expansions: string[];
    };
  };

  const onSubmit = (data: Trigger) => {
    let actionParams: ActionParams = {
      members: [],
      slackWebhook: "",
      datasetId: datasetId,
      datasetMapping: datasetMapping,
    };
    if (data.action === TriggerAction.SEND_EMAIL) {
      actionParams = {
        members: data.members ?? [],
      };
    } else if (data.action === TriggerAction.SEND_SLACK_MESSAGE) {
      actionParams = {
        slackWebhook: data.slackWebhook ?? "",
      };
    } else if (data.action === TriggerAction.ADD_TO_DATASET) {
      actionParams = {
        datasetId: datasetId,
        datasetMapping: datasetMapping,
      };
    }

    createTrigger.mutate(
      {
        projectId: project?.id ?? "",
        name: data.name,
        action: data.action,
        filters: filterParams.filters,
        actionParams: actionParams,
      },
      {
        onSuccess: () => {
          toast({
            title: "Trigger Created",
            description: `You have successfully created a trigger`,

            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          reset();
          closeDrawer();
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Error creating trigger",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const MultiSelect = () => {
    const members = watch("members");
    return (
      <>
        <Popover
          placement="bottom"
          matchWidth={true}
          isOpen={isOpen}
          onOpen={onOpen}
          onClose={onClose}
        >
          <PopoverTrigger>
            <FormControl isInvalid={!!errors.members}>
              <Input
                placeholder="Select email/s"
                defaultValue={members}
                readOnly
                {...register("members", {
                  required: "Please select at least one member",
                })}
              />
              <FormErrorMessage>{errors.members?.message}</FormErrorMessage>
            </FormControl>
          </PopoverTrigger>
          <PopoverContent marginTop="-8px" width="100%">
            <PopoverCloseButton onClick={onClose} zIndex={1000} />
            <PopoverBody>
              <FormControl>
                <Stack spacing={5} direction="column" marginRight={4}>
                  {teamWithMembers.data &&
                    teamWithMembers.data?.members.map((member) => {
                      return (
                        <Checkbox
                          key={member.user.id}
                          {...register("members")}
                          value={member.user!.email ?? ""}
                        >
                          {member.user.email}
                        </Checkbox>
                      );
                    })}
                </Stack>
              </FormControl>
            </PopoverBody>
          </PopoverContent>
        </Popover>
      </>
    );
  };

  const editDataset = useDisclosure();

  return (
    <Drawer
      isOpen={true}
      placement="right"
      size={"xl"}
      onClose={closeDrawer}
      onOverlayClick={closeDrawer}
    >
      <DrawerContent maxWidth="1200px">
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Add Trigger
            </Text>
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <HorizontalFormControl
              label="Name"
              helper="Give it a name that identifies what trigger it might be"
              isInvalid={!!errors.name}
            >
              <Input
                placeholder="Evaluation trigger"
                required
                {...register("name")}
              />
              <FormErrorMessage>{errors.name?.message}</FormErrorMessage>
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Action"
              helper="Select action you would like to take once a your trigger has taken place."
              minWidth="calc(50% - 16px)"
            >
              <RadioGroup defaultValue={TriggerAction.SEND_SLACK_MESSAGE}>
                <Stack spacing={4}>
                  <VStack align="start">
                    <Radio
                      size="md"
                      value={TriggerAction.SEND_SLACK_MESSAGE}
                      colorScheme="blue"
                      alignItems="start"
                      spacing={3}
                      paddingTop={2}
                      {...register("action")}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">Send Slack Message</Text>
                        <Text fontSize={13}>
                          Add your slack webhook url to send a message to when
                          the trigger is activated.
                        </Text>
                      </VStack>
                    </Radio>
                    {currentAction ===
                      (TriggerAction.SEND_SLACK_MESSAGE as TriggerAction) && (
                      <Input
                        placeholder="Your slack hook url"
                        required
                        {...register("slackWebhook")}
                      />
                    )}
                  </VStack>
                  <Tooltip
                    label="Add a SendGrid API key or AWS SES credentials(Only if you are using AWS SES) to your environment variables to enable email functionality."
                    hasArrow
                    placement="top"
                    isDisabled={hasEmailProvider}
                  >
                    <VStack align="start">
                      <Radio
                        size="md"
                        value={TriggerAction.SEND_EMAIL}
                        colorScheme="blue"
                        alignItems="start"
                        spacing={3}
                        paddingTop={2}
                        isDisabled={!hasEmailProvider}
                        {...register("action")}
                      >
                        <Text fontWeight="500">Email</Text>
                        <Text fontSize={13}>
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
                      size="md"
                      value={TriggerAction.ADD_TO_DATASET}
                      colorScheme="blue"
                      alignItems="start"
                      spacing={3}
                      paddingTop={2}
                      {...register("action")}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">Add to Dataset</Text>
                        <Text fontSize={13}>
                          Add entries to the dataset, this allows you to keep
                          track of the results of your triggers.
                        </Text>
                      </VStack>
                    </Radio>
                  </VStack>
                </Stack>
              </RadioGroup>
            </HorizontalFormControl>
            {(currentAction as TriggerAction) ===
              TriggerAction.ADD_TO_DATASET && (
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
                    columnDefs={columnDefs}
                    rowData={rowDataFromDataset}
                    onEditColumns={editDataset.onOpen}
                    onRowDataChange={setRowDataFromDataset}
                    paragraph="This is a sample of the data will look when added to the dataset."
                  />
                )}
              </>
            )}

            <HStack justifyContent="flex-end">
              <Button
                colorScheme="blue"
                type="submit"
                minWidth="fit-content"
                isLoading={createTrigger.isLoading}
              >
                Add Trigger
              </Button>
            </HStack>
          </form>
        </DrawerBody>
      </DrawerContent>
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
        isOpen={editDataset.isOpen}
        onClose={editDataset.onClose}
        onSuccess={onCreateDatasetSuccess}
      />
    </Drawer>
  );
}
