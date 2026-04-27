import {
  Button,
  Field,
  HStack,
  Input,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "~/utils/compat/next-router";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Dialog } from "../../../components/ui/dialog";
import { toaster } from "../../../components/ui/toaster";
import { useLicenseEnforcement } from "../../../hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
import { isHandledByGlobalHandler } from "../../../utils/trpcError";
import { DEFAULT_MODEL } from "../../../utils/constants";
import { trackEvent } from "../../../utils/tracking";
import type { Workflow } from "../../types/dsl";
import { EmojiPickerModal } from "../properties/modals/EmojiPickerModal";

type FormData = {
  name: string;
  icon: string;
  description: string;
};

export const getRandomWorkflowIcon = () => {
  const randomObjectEmojis = [
    // Productivity & Work
    "🧩",
    "⚙️",
    "📊",
    "📈",
    "🧠",
    "🤖",
    "📝",
    "📋",
    "🔍",
    "🛠️",
    "🔧",
    "🧪",
    "📦",

    // Communication & Networking
    "💬",
    "🔔",
    "📨",
    "🔗",
    "📡",
    "🌐",
    "📱",

    // Creative & Design
    "🎨",
    "✏️",
    "🖌️",
    "📷",
    "🎬",
    "🎭",

    // Data & Information
    "📊",
    "📈",
    "📉",
    "🔢",
    "📚",

    // Security & Protection
    "🔒",
    "🛡️",
    "🔑",
    "👁️",

    // Special Purpose
    "🚀",
    "⚡",
    "💡",
    "🧲",
    "🧵",
    "🔮",
    "🎯",
    "⏱️",
    "🧬",
    "🧶",
    "🌟",
    "🎁",
    "🌱",

    // Industry-Specific
    "🏦",
    "🏥",
    "🛒",
    "🎓",
    "🗃️",
    "🏭",

    // Magical/Fantasy
    "✨",
    "🌈",
    "🧙‍♂️",
    "🦄",
    "🧚",

    // Animals with Personality
    "🦊",
    "🦉",
    "🐙",
    "🦁",
    "🐢",
    "🦅",
    "🦋",

    // Food & Drink
    "🍕",
    "🍦",
    "🥤",
    "🍪",
    "🧁",
    "🍯",

    // Fun Objects
    "🎮",
    "🎲",
    "🧸",
    "🎪",
    "🎡",
    "🪄",

    // Weather & Nature
    "🌊",
    "🔥",
    "🍂",
    "🌵",

    // Transportation
    "🚁",
    "🚂",
    "🚗",
    "🛸",

    // Sports & Activities
    "🏄‍♂️",
    "🧗‍♀️",
    "🏆",
  ];

  return randomObjectEmojis[
    Math.floor(Math.random() * randomObjectEmojis.length)
  ]!;
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

  const [defaultIcon] = useState(
    template.icon && template.icon !== "🧩"
      ? template.icon
      : getRandomWorkflowIcon(),
  );

  // License enforcement for workflow creation
  const { checkAndProceed } = useLicenseEnforcement("workflows");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      name: template.name ?? "New Workflow",
      icon: defaultIcon,
      description: template.description ?? "",
    },
  });
  const createWorkflowMutation = api.workflow.create.useMutation();
  const icon = watch("icon");

  const onSubmit = async (data: FormData) => {
    if (!project) return;

    const newWorkflow: Workflow = {
      ...template,
      version: "1",
      name: data.name,
      description: data.description,
      icon: data.icon ?? defaultIcon,
      default_llm: {
        ...template.default_llm,
        model: project?.defaultModel ?? DEFAULT_MODEL,
      },
    };

    checkAndProceed(() => {
      createWorkflowMutation.mutate(
        {
          projectId: project.id,
          dsl: newWorkflow,
          commitMessage: "Workflow creation",
        },
        {
          onSuccess: (createdWorkflow) => {
            trackEvent("workflow_create", { project_id: project?.id });
            onClose();
            void router.push(
              `/${project.slug}/studio/${createdWorkflow.workflow.id}`,
            );
          },
          onError: (error) => {
            // Skip toast if the global license handler already showed the upgrade modal
            if (isHandledByGlobalHandler(error)) return;
            toaster.create({
              title: "Error creating workflow",
              description: error.message,
              type: "error",
            });
          },
        },
      );
    });
  };

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (nameRef.current) {
      nameRef.current.value = template.name ?? "New Workflow";
      nameRef.current.focus();
    }
    setValue("name", template.name ?? "New Workflow");
    setValue("icon", defaultIcon);
    setValue("description", template.description ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  return (
    <>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
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
                <Button
                  variant="outline"
                  onClick={emojiPicker.onOpen}
                  fontSize="18px"
                >
                  {icon}
                </Button>
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
    </>
  );
};
