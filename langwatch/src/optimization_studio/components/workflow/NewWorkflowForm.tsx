import {
  Button,
  Field,
  HStack,
  Input,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
import type { Workflow } from "../../types/dsl";
import { EmojiPickerModal } from "../properties/modals/EmojiPickerModal";
import { trackEvent } from "../../../utils/tracking";
import { toaster } from "../../../components/ui/toaster";
import { Dialog } from "../../../components/ui/dialog";

type FormData = {
  name: string;
  icon: string;
  description: string;
};

export const NewWorkflowForm = ({
  template,
  onClose,
}: {
  template: Workflow;
  onClose: () => void;
}) => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const emojiPicker = useDisclosure();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      name: template.name ?? "New Workflow",
      icon: template.icon ?? "🧩",
      description: template.description ?? "",
    },
  });
  const createWorkflowMutation = api.workflow.create.useMutation();
  const icon = watch("icon");

  const onSubmit = async (data: FormData) => {
    if (!project) return;

    try {
      const newWorkflow: Workflow = {
        ...template,
        name: data.name,
        description: data.description,
        icon: data.icon ?? "🧩",
      };
      const createdWorkflow = await createWorkflowMutation.mutateAsync(
        {
          projectId: project.id,
          dsl: newWorkflow,
          commitMessage: "Workflow creation",
        },
        {
          onError: () => {
            toaster.create({
              title: "Error",
              description: "Failed to create workflow",
              type: "error",
              meta: {
                closable: true,
              },
              placement: "top-end",
            });
          },
        }
      );

      trackEvent("workflow_create", { project_id: project?.id });

      onClose();
      void router.push(
        `/${project.slug}/studio/${createdWorkflow.workflow.id}`
      );
    } catch (error) {
      console.error("Error creating workflow:", error);
    }
  };

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (nameRef.current) {
      nameRef.current.value = template.name ?? "New Workflow";
      nameRef.current.focus();
    }
    setValue("name", template.name ?? "New Workflow");
    setValue("icon", template.icon ?? "🧩");
    setValue("description", template.description ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <Dialog.Body>
        <VStack gap={4} align="stretch">
          <Field.Root invalid={!!errors.name}>
            <EmojiPickerModal
              open={emojiPicker.open}
              onClose={emojiPicker.onClose}
              onChange={(emoji) => {
                setValue("icon", emoji);
                emojiPicker.onClose();
              }}
            />
            <Field.Label>Name and Icon</Field.Label>
            <HStack>
              <Button onClick={emojiPicker.onOpen}>{icon}</Button>
              <Input
                {...register("name", { required: "Name is required" })}
                ref={nameRef}
                onChange={(e) => {
                  setValue("name", e.target.value);
                }}
              />
            </HStack>
            <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
          </Field.Root>
          <Field.Root invalid={!!errors.description}>
            <Field.Label>Description</Field.Label>
            <Textarea {...register("description")} />
            <Field.ErrorText>{errors.description?.message}</Field.ErrorText>
          </Field.Root>
        </VStack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button
          type="submit"
          colorPalette="blue"
          loading={createWorkflowMutation.isLoading}
          onClick={() => {
            void handleSubmit(onSubmit)();
          }}
        >
          Create Workflow
        </Button>
      </Dialog.Footer>
    </form>
  );
};
