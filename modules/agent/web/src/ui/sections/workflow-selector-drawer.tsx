import {
  Alert,
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Text,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { applyHandledErrorToForm, showErrorToast } from "@langwatch/ui-host/errors";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";

export interface CreateWorkflowAgentInput {
  name: string;
  icon: string;
  description: string;
}

export interface WorkflowSelectorDrawerProps {
  open: boolean;
  agentName?: string;
  defaultIcon: string;
  isSaving: boolean;
  onClose(): void;
  onGoBack?: () => void;
  onCreate(input: CreateWorkflowAgentInput): Promise<void>;
  renderIconPicker(props: {
    open: boolean;
    onClose(): void;
    onChange(icon: string): void;
  }): ReactNode;
}

export function WorkflowSelectorDrawer(props: WorkflowSelectorDrawerProps) {
  const picker = useDisclosure();
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
  const name = watch("name");

  async function submit(input: CreateWorkflowAgentInput) {
    await props.onCreate(input).catch((error: unknown) => {
      if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
      showErrorToast({ error, fallbackTitle: "Couldn't create workflow agent" });
    });
  }

  return (
    <Drawer.Root
      open={props.open}
      onOpenChange={({ open }) => !open && props.onClose()}
      size="md"
      modal={false}
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            {props.onGoBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={props.onGoBack}
                padding={1}
                minWidth="auto"
                data-testid="back-button"
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </Button>
            )}
            <Heading>Create Workflow Agent</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
              Create a new workflow to use as a custom agent. You&apos;ll be taken to the workflow
              editor to configure the agent logic.
            </Text>
            <Box paddingX={6}>
              <VStack gap={4} align="stretch">
                {errors.root?.serverError?.message && (
                  <Alert.Root status="error" role="alert">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>{errors.root.serverError.message}</Alert.Description>
                    </Alert.Content>
                  </Alert.Root>
                )}
                <Field.Root invalid={!!errors.name || !!errors.icon}>
                  {props.renderIconPicker({
                    open: picker.open,
                    onClose: picker.onClose,
                    onChange(emoji) {
                      setValue("icon", emoji);
                      picker.onClose();
                    },
                  })}
                  <Field.Label>Name and Icon</Field.Label>
                  <HStack>
                    <Button variant="outline" onClick={picker.onOpen} fontSize="18px">
                      {icon}
                    </Button>
                    <Input
                      {...register("name", { required: "Name is required" })}
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
            </Box>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <HStack gap={3}>
            <Button variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={() => void handleSubmit(submit)()}
              disabled={!name.trim() || isSaving}
              loading={isSaving}
              data-testid="save-agent-button"
            >
              Create &amp; Open Editor
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
