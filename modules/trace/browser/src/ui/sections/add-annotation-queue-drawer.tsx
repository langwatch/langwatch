import type { AnnotationQueueDetail } from "@langwatch/annotation-contract";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { Popover } from "@langwatch/design-system/popover";
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
} from "@langwatch/design-system/primitives";
import { slugify } from "@langwatch/design-system/slugify";
import { toaster } from "@langwatch/design-system/toaster";
import { useState } from "react";
import { Check, ChevronDown, Plus } from "react-feather";
import { useForm } from "react-hook-form";

import {
  useAnnotationQueue,
  useActiveAnnotationScores,
} from "../../behavior/reads/use-annotation-reads.ts";
import { useOrganizationMembersWithTeams } from "../../behavior/reads/use-organization-members.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import { useCreateOrUpdateAnnotationQueue } from "../../behavior/writes/use-trace-writes.ts";
import { RandomColorAvatar } from "../blocks/random-color-avatar.tsx";
import { FullWidthFormControl } from "../elements/full-width-form-control.tsx";
import { Drawer } from "./drawer.tsx";
import { applyHandledErrorToForm, FormServerError, showErrorToast } from "./errors/index.ts";

type Picked = { id: string; name: string | null };
type QueueData =
  | Pick<AnnotationQueueDetail, "members" | "AnnotationQueueScores">
  | null
  | undefined;

function participantsOf(queue: QueueData): Picked[] {
  return (queue?.members ?? []).map((m) => ({ id: m.user.id, name: m.user.name }));
}

function scoreTypesOf(queue: QueueData): Picked[] {
  return (queue?.AnnotationQueueScores ?? []).map((s) => ({
    id: s.annotationScore.id,
    name: s.annotationScore.name,
  }));
}

function queueSlug(name: string | undefined): string {
  return slugify((name || "").replace("_", "-"), { lower: true, strict: true });
}

function toastQueueSaved({ isUpdate, name }: { isUpdate: boolean; name: string }) {
  toaster.create({
    title: `Annotation Queue ${isUpdate ? "Updated" : "Created"}`,
    description: `Successfully ${isUpdate ? "updated" : "created"} ${name} annotation queue`,
    type: "success",
  });
}

function toggled(list: Picked[], item: Picked): Picked[] {
  return list.some((p) => p.id === item.id)
    ? list.filter((p) => p.id !== item.id)
    : [...list, item];
}

/** A button listing the picked items as tags, opening a list to toggle them. */
function MultiPick({
  disclosure,
  placeholder,
  selected,
  options,
  withAvatar = false,
  onToggle,
  footer,
}: {
  disclosure: ReturnType<typeof useDisclosure>;
  placeholder: string;
  selected: Picked[];
  options: Picked[];
  withAvatar?: boolean;
  onToggle: (item: Picked) => void;
  footer?: React.ReactNode;
}) {
  return (
    <Popover.Root
      open={disclosure.open}
      onOpenChange={({ open }) => disclosure.setOpen(open)}
      positioning={{ placement: "bottom-start" }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          width="full"
          justifyContent="space-between"
          fontWeight="normal"
          color={selected.length === 0 ? "fg.subtle" : "fg"}
          paddingX={3}
        >
          {selected.length === 0 ? (
            placeholder
          ) : (
            <HStack gap={1} flexWrap="wrap" flex={1}>
              {selected.map((p) => (
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
        <Popover.Body padding={footer ? 0 : undefined}>
          <Box
            maxH={footer ? "250px" : undefined}
            overflowY={footer ? "auto" : undefined}
            padding={footer ? 2 : 0}
          >
            <VStack align="start" gap={1}>
              {options.map((option) => {
                const isSelected = selected.some((p) => p.id === option.id);
                return (
                  <Button
                    key={option.id}
                    variant="ghost"
                    width="full"
                    justifyContent="flex-start"
                    padding={1}
                    height="auto"
                    fontWeight="normal"
                    aria-pressed={isSelected}
                    onClick={() => onToggle(option)}
                  >
                    <Check size={16} color={isSelected ? "green" : "transparent"} />
                    {withAvatar && <RandomColorAvatar size="2xs" name={option.name ?? ""} />}
                    <Text fontSize="sm">{option.name}</Text>
                  </Button>
                );
              })}
            </VStack>
          </Box>
          {footer && (
            <Box padding={2} borderTop="1px solid" borderColor="border.muted">
              {footer}
            </Box>
          )}
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

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
  const createOrUpdateQueue = useCreateOrUpdateAnnotationQueue();

  const queue = useAnnotationQueue({ projectId: project?.id, queueId, enabled: !!open });

  const handleClose = () => {
    if (onOverlayClick) {
      onClose?.();
      onOverlayClick();
    } else {
      closeDrawer();
    }
  };

  const annotationScores = useActiveAnnotationScores({ projectId: project?.id, enabled: !!open });

  const { closeDrawer, openDrawer } = useDrawer();

  const closeAll = () => {
    closeDrawer();
    onClose?.();
  };

  const users = useOrganizationMembersWithTeams({
    organizationId: organization?.id,
    enabled: !!open,
  });

  const form = useForm<{
    name: string;
    description?: string | null;
  }>({
    defaultValues: {
      name: queue.data?.name ?? "",
      description: queue.data?.description ?? "",
    },
    values: queue.data
      ? { name: queue.data.name, description: queue.data.description ?? "" }
      : undefined,
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = form;

  type FormData = {
    name: string;
    description?: string | null;
  };

  // The queue's own picks until the user toggles one; a refetch never overwrites an edit.
  const [editedParticipants, setParticipants] = useState<Picked[]>();
  const [editedScoreTypes, setScoreTypes] = useState<Picked[]>();
  const participants = editedParticipants ?? participantsOf(queue.data);
  const scoreTypes = editedScoreTypes ?? scoreTypesOf(queue.data);

  const onSubmit = (data: FormData) => {
    if (participants.length === 0 || scoreTypes.length === 0) {
      showErrorToast({
        fallbackTitle: "Couldn't save the annotation queue",
        description: "Please select at least one participant and score type.",
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
          toastQueueSaved({ isUpdate: !!queueId, name: data.name });
          handleClose();
          reset();
        },
        onError: (error) => {
          if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
          showErrorToast({
            error,
            fallbackTitle: `Couldn't ${queueId ? "update" : "create"} annotation queue`,
          });
        },
      },
    );
  };

  const participantsPopoverOpen = useDisclosure();
  const scoreTypesPopoverOpen = useDisclosure();

  const name = watch("name");
  const slug = queueSlug(name);

  return (
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
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger onClick={() => closeAll()} />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              {queueId ? "Edit Annotation Queue" : "Create Annotation Queue"}
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <form onSubmit={handleSubmit(onSubmit)}>
            <VStack align="start">
              <FormServerError form={form} />

              <FullWidthFormControl
                label="Participants"
                helper="Select the participants for this annotation queue"
              >
                <MultiPick
                  disclosure={participantsPopoverOpen}
                  placeholder="Add Participants"
                  selected={participants}
                  options={(users.data?.members ?? []).map((member) => ({
                    id: member.user.id,
                    name: member.user.name,
                  }))}
                  withAvatar
                  onToggle={(item) => setParticipants(toggled(participants, item))}
                />
              </FullWidthFormControl>

              <FullWidthFormControl
                label="Name Annotation Queue"
                helper="Give it a name to identify this annotation queue"
                invalid={!!errors.name}
              >
                <Input {...register("name")} required />
                {slug && <Field.HelperText>slug: {slug}</Field.HelperText>}
                <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
              </FullWidthFormControl>

              <FullWidthFormControl
                label="Description"
                helper="Provide a description of the annotation"
                invalid={!!errors.description}
              >
                <Textarea {...register("description")} required />
                <Field.ErrorText>{errors.description?.message}</Field.ErrorText>
              </FullWidthFormControl>

              <FullWidthFormControl
                label="Score Type"
                helper="Select the score type for this annotation queue"
              >
                <MultiPick
                  disclosure={scoreTypesPopoverOpen}
                  placeholder="Add Score Type"
                  selected={scoreTypes}
                  options={(annotationScores.data ?? []).map((score) => ({
                    id: score.id,
                    name: score.name,
                  }))}
                  onToggle={(item) => setScoreTypes(toggled(scoreTypes, item))}
                  footer={
                    <Button
                      width="100%"
                      colorPalette="blue"
                      onClick={() => {
                        scoreTypesPopoverOpen.onClose();
                        openDrawer("addOrEditAnnotationScore");
                      }}
                      variant="outline"
                      size="sm"
                    >
                      <Plus /> Add New
                    </Button>
                  }
                />
              </FullWidthFormControl>

              <HStack width="full">
                <Spacer />
                <Button
                  colorPalette="orange"
                  type="submit"
                  minWidth="fit-content"
                  loading={createOrUpdateQueue.isPending}
                >
                  Save
                </Button>
              </HStack>
            </VStack>
          </form>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
};
