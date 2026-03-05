import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Text,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { chakraComponents, Select as MultiSelect } from "chakra-react-select";
import { useState } from "react";
import { Plus } from "react-feather";
import { useForm } from "react-hook-form";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { slugify } from "~/utils/slugify";
import { Drawer } from "../components/ui/drawer";
import { toaster } from "../components/ui/toaster";
import { AddOrEditAnnotationScore } from "./annotations/AddOrEditAnnotationScore";
import { FullWidthFormControl } from "./FullWidthFormControl";
import { RandomColorAvatar } from "./RandomColorAvatar";

export const AddAnnotationQueueDrawer = ({
  open = true,
  onClose,
  onOverlayClick,
  queueId,
}: {
  open?: boolean;
  onClose?: () => void;
  onOverlayClick?: () => void;
  queueId?: string;
}) => {
  const { project, organization } = useOrganizationTeamProject();
  const createOrUpdateQueue = api.annotation.createOrUpdateQueue.useMutation();

  const queue = api.annotation.getQueueBySlugOrId.useQuery(
    {
      queueId: queueId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project && !!queueId && open,
    },
  );

  const handleClose = () => {
    if (onOverlayClick) {
      onClose?.();
      onOverlayClick();
    } else {
      closeDrawer();
    }
  };

  const queryClient = api.useContext();

  const annotationScores = api.annotationScore.getAllActive.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project && open,
    },
  );

  const { closeDrawer } = useDrawer();

  const closeAll = () => {
    closeDrawer();
    onClose?.();
  };

  const users =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      {
        enabled: !!organization && open,
      },
    );
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<{
    name: string;
    description?: string | null;
  }>({
    defaultValues: {
      name: queue.data?.name ?? "",
      description: queue.data?.description ?? "",
    },
  });

  type FormData = {
    name: string;
    description?: string | null;
  };

  const [participants, setParticipants] = useState<
    { id: string; name: string | null }[]
  >(
    queue.data?.members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
    })) ?? [],
  );

  const [scoreTypes, setScoreTypes] = useState<
    { id: string; name: string | null }[]
  >(
    queue.data?.AnnotationQueueScores.map((score) => ({
      id: score.annotationScore.id,
      name: score.annotationScore.name,
    })) ?? [],
  );

  const onSubmit = (data: FormData) => {
    if (participants.length === 0 || scoreTypes.length === 0) {
      toaster.create({
        title: "Error",
        description: "Please select at least one participant and score type",
        type: "error",
      });
      return;
    }
    createOrUpdateQueue.mutate(
      {
        name: data.name,
        description: data.description ?? "",
        userIds: participants.map((p) => p.id),
        projectId: project?.id ?? "",
        scoreTypeIds: scoreTypes.map((s) => s.id),
        queueId: queueId,
      },
      {
        onSuccess: (data) => {
          void queryClient.annotation.getOptimizedAnnotationQueues.invalidate();
          void queryClient.annotation.getQueueBySlugOrId.invalidate();
          toaster.create({
            title: `Annotation Queue ${queueId ? "Updated" : "Created"}`,
            description: `Successfully ${queueId ? "updated" : "created"} ${
              data.name
            } annotation queue`,
            type: "success",
            meta: {
              closable: true,
            },
          });
          handleClose();
          reset();
        },
        onError: (error) => {
          toaster.create({
            title: "Error creating annotation score",
            description: error.message,
            type: "error",
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  const scoreTypeDrawerOpen = useDisclosure();

  const name = watch("name");
  const slug = slugify((name || "").replace("_", "-"), {
    lower: true,
    strict: true,
  });

  return (
    <>
      <Drawer.Root
        open={open}
        placement="end"
        size="lg"
        onOpenChange={({ open }) => {
          if (!open) {
            closeAll();
          }
        }}
      >
        <Drawer.Content>
          <Drawer.Header>
            <HStack>
              <Drawer.CloseTrigger onClick={() => closeAll()} />
            </HStack>
            <HStack>
              <Text paddingTop={5} fontSize="2xl">
                Create Annotation Queue
              </Text>
            </HStack>
          </Drawer.Header>
          <Drawer.Body>
            {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
            <form onSubmit={handleSubmit(onSubmit)}>
              <VStack align="start">
                <MultiSelect
                  options={users.data?.members.map((member) => ({
                    label: member.user.name ?? "",
                    value: member.user.id,
                  }))}
                  onChange={(newValue) => {
                    setParticipants(
                      newValue.map((v) => ({
                        id: v.value,
                        name: v.label,
                      })),
                    );
                  }}
                  value={participants.map((p) => ({
                    value: p.id,
                    label: p.name ?? "",
                  }))}
                  isMulti
                  closeMenuOnSelect={false}
                  selectedOptionStyle="check"
                  hideSelectedOptions={true}
                  placeholder="Add Participants"
                  components={{
                    Menu: ({ children, ...props }) => (
                      <chakraComponents.Menu
                        {...props}
                        innerProps={{
                          ...props.innerProps,
                          style: { width: "300px" },
                        }}
                      >
                        {children}
                      </chakraComponents.Menu>
                    ),
                    Option: ({ children, ...props }) => (
                      <chakraComponents.Option {...props}>
                        <VStack align="start">
                          <HStack>
                            <RandomColorAvatar
                              size="2xs"
                              name={props.data.label}
                            />
                            <Text>{children}</Text>
                          </HStack>
                        </VStack>
                      </chakraComponents.Option>
                    ),
                    MultiValueLabel: ({ children, ...props }) => (
                      <chakraComponents.MultiValueLabel {...props}>
                        <VStack align="start" padding={1} paddingX={0}>
                          <HStack>
                            <RandomColorAvatar
                              size="2xs"
                              name={props.data.label}
                            />
                            <Text>{children}</Text>
                          </HStack>
                        </VStack>
                      </chakraComponents.MultiValueLabel>
                    ),
                  }}
                />

                <FullWidthFormControl
                  label="Name Annotation Queue"
                  helper="Give it a name to identify this annotation queue"
                  invalid={!!errors.name}
                >
                  <Input {...register("name")} required />
                  {slug && <Field.HelperText>slug: {slug}</Field.HelperText>}
                </FullWidthFormControl>

                <FullWidthFormControl
                  label="Description"
                  helper="Provide a description of the annotation"
                  invalid={!!errors.description}
                >
                  <Textarea {...register("description")} required />
                </FullWidthFormControl>

                <Field.Root>
                  <VStack align="start" gap={1}>
                    <Field.Label margin={0}>Score Type</Field.Label>
                    <Field.HelperText margin={0}>
                      Select the score type for this annotation queue
                    </Field.HelperText>

                    <MultiSelect
                      options={annotationScores.data?.map((score) => ({
                        label: score.name,
                        value: score.id,
                      }))}
                      onChange={(newValue) => {
                        setScoreTypes(
                          newValue.map((v) => ({
                            id: v.value,
                            name: v.label,
                          })),
                        );
                      }}
                      value={scoreTypes.map((v) => ({
                        value: v.id,
                        label: v.name ?? "",
                      }))}
                      isMulti
                      closeMenuOnSelect={false}
                      selectedOptionStyle="check"
                      hideSelectedOptions={true}
                      placeholder="Add Score Type"
                      components={{
                        Menu: ({ children, ...props }) => (
                          <chakraComponents.Menu
                            {...props}
                            innerProps={{
                              ...props.innerProps,
                              style: { width: "300px" },
                            }}
                          >
                            {children}
                          </chakraComponents.Menu>
                        ),
                        MultiValueLabel: ({ ...props }) => (
                          <chakraComponents.MultiValueLabel {...props}>
                            <VStack align="start" padding={1} paddingX={0}>
                              <HStack>
                                <Text>{props.data.label}</Text>
                              </HStack>
                            </VStack>
                          </chakraComponents.MultiValueLabel>
                        ),
                        MenuList: (props) => (
                          <chakraComponents.MenuList {...props} maxHeight={300}>
                            <Box
                              maxH="250px"
                              overflowY="auto"
                              css={{
                                "&::-webkit-scrollbar": {
                                  display: "none",
                                },
                                msOverflowStyle: "none", // IE and Edge
                                scrollbarWidth: "none", // Firefox
                              }}
                            >
                              {props.children}
                            </Box>
                            <Box
                              p={2}
                              position="sticky"
                              bottom={0}
                              bg="white"
                              borderTop="1px solid"
                              borderColor="border.muted"
                            >
                              <Button
                                width="100%"
                                colorPalette="blue"
                                onClick={scoreTypeDrawerOpen.onOpen}
                                variant="outline"
                                size="sm"
                              >
                                <Plus /> Add New
                              </Button>
                            </Box>
                          </chakraComponents.MenuList>
                        ),
                      }}
                    />
                  </VStack>
                </Field.Root>
                <HStack width="full">
                  <Spacer />
                  <Button
                    colorPalette="orange"
                    type="submit"
                    minWidth="fit-content"
                    loading={createOrUpdateQueue.isLoading}
                  >
                    Save
                  </Button>
                </HStack>
              </VStack>
            </form>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
      <Drawer.Root
        open={scoreTypeDrawerOpen.open}
        placement="end"
        size="lg"
        onOpenChange={({ open }) => scoreTypeDrawerOpen.setOpen(open)}
      >
        <Drawer.Content>
          <Drawer.Header>
            <HStack>
              <Drawer.CloseTrigger />
            </HStack>
            <HStack>
              <Text paddingTop={5} fontSize="2xl">
                Add Score Metric
              </Text>
            </HStack>
          </Drawer.Header>
          <Drawer.Body>
            <AddOrEditAnnotationScore onClose={scoreTypeDrawerOpen.onClose} />
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
};
