import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Tag,
  Text,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Check, ChevronDown, Plus } from "react-feather";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { slugify } from "~/utils/slugify";
import { Drawer } from "../components/ui/drawer";
import { Popover } from "../components/ui/popover";
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
      enabled: !!project && !!queueId && !!open,
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
      enabled: !!project && !!open,
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
        enabled: !!organization && !!open,
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

  // Sync local state when queue data loads (edit mode hydration)
  useEffect(() => {
    if (!queue.data) return;
    setParticipants(
      queue.data.members.map((m) => ({ id: m.user.id, name: m.user.name })),
    );
    setScoreTypes(
      queue.data.AnnotationQueueScores.map((s) => ({
        id: s.annotationScore.id,
        name: s.annotationScore.name,
      })),
    );
    reset({
      name: queue.data.name,
      description: queue.data.description ?? "",
    });
  }, [queue.data, reset]);

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
          if (isHandledByGlobalHandler(error)) return;
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
  const participantsPopoverOpen = useDisclosure();
  const scoreTypesPopoverOpen = useDisclosure();

  const name = watch("name");
  const slug = slugify((name || "").replace("_", "-"), {
    lower: true,
    strict: true,
  });

  const toggleParticipant = (id: string, memberName: string | null) => {
    setParticipants((prev) =>
      prev.some((p) => p.id === id)
        ? prev.filter((p) => p.id !== id)
        : [...prev, { id, name: memberName }],
    );
  };

  const toggleScoreType = (id: string, scoreName: string) => {
    setScoreTypes((prev) =>
      prev.some((s) => s.id === id)
        ? prev.filter((s) => s.id !== id)
        : [...prev, { id, name: scoreName }],
    );
  };

  return (
    <>
      <Drawer.Root
        open={!!open}
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
                <FullWidthFormControl
                  label="Participants"
                  helper="Select the participants for this annotation queue"
                >
                  <Popover.Root
                    open={participantsPopoverOpen.open}
                    onOpenChange={({ open }) =>
                      participantsPopoverOpen.setOpen(open)
                    }
                    positioning={{ placement: "bottom-start" }}
                  >
                    <Popover.Trigger asChild>
                      <Button
                        variant="outline"
                        width="full"
                        justifyContent="space-between"
                        fontWeight="normal"
                        color={
                          participants.length === 0 ? "fg.subtle" : "fg"
                        }
                        paddingX={3}
                      >
                        {participants.length === 0 ? (
                          "Add Participants"
                        ) : (
                          <HStack gap={1} flexWrap="wrap" flex={1}>
                            {participants.map((p) => (
                              <Tag.Root key={p.id} size="sm">
                                <Tag.Label>{p.name}</Tag.Label>
                              </Tag.Root>
                            ))}
                          </HStack>
                        )}
                        <ChevronDown size={16} />
                      </Button>
                    </Popover.Trigger>
                    <Popover.Content width="300px">
                      <Popover.Body>
                        <VStack align="start" gap={1}>
                          {users.data?.members.map((member) => {
                            const isSelected = participants.some(
                              (p) => p.id === member.user.id,
                            );
                            return (
                              <Button
                                key={member.user.id}
                                variant="ghost"
                                width="full"
                                justifyContent="flex-start"
                                padding={1}
                                height="auto"
                                fontWeight="normal"
                                aria-pressed={isSelected}
                                onClick={() =>
                                  toggleParticipant(
                                    member.user.id,
                                    member.user.name,
                                  )
                                }
                              >
                                <Check
                                  size={16}
                                  color={isSelected ? "green" : "transparent"}
                                />
                                <RandomColorAvatar
                                  size="2xs"
                                  name={member.user.name ?? ""}
                                />
                                <Text fontSize="sm">{member.user.name}</Text>
                              </Button>
                            );
                          })}
                        </VStack>
                      </Popover.Body>
                    </Popover.Content>
                  </Popover.Root>
                </FullWidthFormControl>

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

                <FullWidthFormControl
                  label="Score Type"
                  helper="Select the score type for this annotation queue"
                >
                  <Popover.Root
                    open={scoreTypesPopoverOpen.open}
                    onOpenChange={({ open }) =>
                      scoreTypesPopoverOpen.setOpen(open)
                    }
                    positioning={{ placement: "bottom-start" }}
                  >
                    <Popover.Trigger asChild>
                      <Button
                        variant="outline"
                        width="full"
                        justifyContent="space-between"
                        fontWeight="normal"
                        color={
                          scoreTypes.length === 0 ? "fg.subtle" : "fg"
                        }
                        paddingX={3}
                      >
                        {scoreTypes.length === 0 ? (
                          "Add Score Type"
                        ) : (
                          <HStack gap={1} flexWrap="wrap" flex={1}>
                            {scoreTypes.map((s) => (
                              <Tag.Root key={s.id} size="sm">
                                <Tag.Label>{s.name}</Tag.Label>
                              </Tag.Root>
                            ))}
                          </HStack>
                        )}
                        <ChevronDown size={16} />
                      </Button>
                    </Popover.Trigger>
                    <Popover.Content width="300px">
                      <Popover.Body padding={0}>
                        <Box maxH="250px" overflowY="auto" padding={2}>
                          <VStack align="start" gap={1}>
                            {annotationScores.data?.map((score) => {
                              const isSelected = scoreTypes.some(
                                (s) => s.id === score.id,
                              );
                              return (
                                <Button
                                  key={score.id}
                                  variant="ghost"
                                  width="full"
                                  justifyContent="flex-start"
                                  padding={1}
                                  height="auto"
                                  fontWeight="normal"
                                  aria-pressed={isSelected}
                                  onClick={() =>
                                    toggleScoreType(score.id, score.name)
                                  }
                                >
                                  <Check
                                    size={16}
                                    color={
                                      isSelected ? "green" : "transparent"
                                    }
                                  />
                                  <Text fontSize="sm">{score.name}</Text>
                                </Button>
                              );
                            })}
                          </VStack>
                        </Box>
                        <Box
                          padding={2}
                          borderTop="1px solid"
                          borderColor="border.muted"
                        >
                          <Button
                            width="100%"
                            colorPalette="blue"
                            onClick={() => {
                              scoreTypesPopoverOpen.onClose();
                              scoreTypeDrawerOpen.onOpen();
                            }}
                            variant="outline"
                            size="sm"
                          >
                            <Plus /> Add New
                          </Button>
                        </Box>
                      </Popover.Body>
                    </Popover.Content>
                  </Popover.Root>
                </FullWidthFormControl>

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
