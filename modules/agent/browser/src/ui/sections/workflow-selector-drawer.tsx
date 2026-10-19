import { applyHandledErrorToForm, showErrorToast } from "@langwatch/browser-host/errors";
import { Drawer } from "@langwatch/design-system/drawer";
import { EmojiPicker } from "@langwatch/design-system/emoji-picker";
import {
  Alert,
  Field,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import { useForm } from "react-hook-form";

import type { CreateWorkflowAgentInput } from "../../model/workflow/create-workflow-agent-input.ts";

export type { CreateWorkflowAgentInput };

export interface WorkflowSelectorDrawerProps {
  open: boolean;
  agentName?: string;
  defaultIcon: string;
  isSaving: boolean;
  onClose: () => void;
  onGoBack?: () => void;
  onCreate(input: CreateWorkflowAgentInput): Promise<void>;
}

export function WorkflowSelectorDrawer(props: WorkflowSelectorDrawerProps) {
  const form = useForm<CreateWorkflowAgentInput>({
    defaultValues: { name: props.agentName ?? "", icon: props.defaultIcon, description: "" },
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;
  const isSaving = props.isSaving || isSubmitting;
  const icon = watch("icon");

  async function submit(input: CreateWorkflowAgentInput) {
    await props.onCreate(input).catch((error: unknown) => {
      if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
      showErrorToast({ error, fallbackTitle: "Couldn't create workflow agent" });
    });
  }

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      onBack={props.onGoBack}
      backButtonTestId="back-button"
      size="md"
      title="Create Workflow Agent"
      footer={{
        cancel: { onClick: props.onClose },
        primaryAction: {
          label: "Create & Open Editor",
          onClick: () => {
            if (!isSaving) void handleSubmit(submit)();
          },
          loading: isSaving,
          "data-testid": "save-agent-button",
        },
      }}
    >
      <VStack gap={4} align="stretch">
        <Text color="fg.muted" fontSize="sm">
          Create a new workflow to use as a custom agent. You&apos;ll be taken to the workflow
          editor to configure the agent logic.
        </Text>
        {errors.root?.serverError?.message && (
          <Alert.Root status="error" role="alert">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{errors.root.serverError.message}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}
        <Field.Root invalid={!!errors.name || !!errors.icon}>
          <Field.Label>Name and Icon</Field.Label>
          <HStack>
            <EmojiPicker value={icon} onChange={(emoji) => setValue("icon", emoji)} />
            <Input
              {...register("name", {
                validate: (value) => value.trim() !== "" || "Name is required",
              })}
              placeholder="Enter agent name"
              data-testid="agent-name-input"
            />
          </HStack>
          <Field.ErrorText>{errors.name?.message ?? errors.icon?.message}</Field.ErrorText>
        </Field.Root>
        <Field.Root invalid={!!errors.description}>
          <Field.Label>Description (optional)</Field.Label>
          <Textarea {...register("description")} placeholder="What does this agent do?" />
          <Field.ErrorText>{errors.description?.message}</Field.ErrorText>
        </Field.Root>
      </VStack>
    </Drawer>
  );
}
