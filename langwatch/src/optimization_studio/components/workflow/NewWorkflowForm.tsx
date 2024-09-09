import { useRef, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import {
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  Input,
  ModalBody,
  ModalFooter,
  Textarea,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { EmojiPickerModal } from "../properties/modals/EmojiPickerModal";
import { api } from "../../../utils/api";
import type { Workflow } from "../../types/dsl";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

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
  const toast = useToast();
  const emojiPicker = useDisclosure();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
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
          onError: (error) => {
            toast({
              title: "Error",
              description: "Failed to create workflow",
              status: "error",
              isClosable: true,
              duration: 5000,
            });
          },
        }
      );
      onClose();
      void router.push(`/studio/${createdWorkflow.workflow.id}`);
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
  }, [template]);

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <ModalBody>
        <VStack spacing={4} align="stretch">
          <FormControl isInvalid={!!errors.name}>
            <EmojiPickerModal
              isOpen={emojiPicker.isOpen}
              onClose={emojiPicker.onClose}
              onChange={(emoji) => {
                setValue("icon", emoji);
                emojiPicker.onClose();
              }}
            />
            <FormLabel>Name and Icon</FormLabel>
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
            <FormErrorMessage>{errors.name?.message}</FormErrorMessage>
          </FormControl>
          <FormControl isInvalid={!!errors.description}>
            <FormLabel>Description</FormLabel>
            <Textarea {...register("description")} />
            <FormErrorMessage>{errors.description?.message}</FormErrorMessage>
          </FormControl>
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          colorScheme="blue"
          isLoading={createWorkflowMutation.isLoading}
          onClick={(e) => {
            console.log("submit 0");
            handleSubmit(onSubmit)();
          }}
        >
          Create Workflow
        </Button>
      </ModalFooter>
    </form>
  );
};
