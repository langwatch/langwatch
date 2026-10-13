import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@langwatch/design-system/dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Button, Field, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { PromptScope } from "@langwatch/prompt-contract";
import { Building, Check, ChevronDown, Users } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";

import { usePromptHandleCheck } from "../../../../behavior/use-prompt-handle-check.ts";
import {
  type ChangeHandleFormValues,
  createChangeHandleFormSchema,
} from "../../../../prompt-form.ts";

export interface ChangeHandleDialogProps {
  currentHandle?: string | null;
  currentScope?: PromptScope;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ChangeHandleFormValues) => Promise<void>;
}

export function ChangeHandleDialog({
  currentHandle,
  currentScope,
  isOpen,
  onClose,
  onSubmit,
}: ChangeHandleDialogProps) {
  const { checkHandleUniqueness } = usePromptHandleCheck();

  // Determine the current values - use config if available, otherwise use direct props
  const handle = currentHandle ?? "";
  const scope = currentScope ?? PromptScope.PROJECT;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    control,
  } = useForm<ChangeHandleFormValues>({
    defaultValues: {
      handle,
      scope: scope,
    },
    resolver: zodResolver(createChangeHandleFormSchema({ checkHandleUniqueness })),
  });

  /**
   * Reset the form values when the component mounts.
   */
  useEffect(() => {
    // The compiled dialog never re-calls register(), so a reset keeps its fields (WEB-5030).
    reset({ handle, scope }, { keepFieldsRef: true });
  }, [handle, scope, reset]);

  /**
   * Submit the form values when the form is submitted.
   */
  const submitCallback = useCallback(
    async (data: ChangeHandleFormValues) => {
      if (data.handle === handle && data.scope === scope) {
        onClose();
        return;
      }
      await onSubmit({
        handle: data.handle,
        scope: data.scope,
      });
      reset(undefined, { keepFieldsRef: true });
    },
    [onSubmit, onClose, reset, handle, scope],
  );

  const handleHandler = register("handle", {
    required: "Prompt identifier is required",
  });

  const closeAndReset = () => {
    reset(undefined, { keepFieldsRef: true });
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onClose={closeAndReset}
      title={currentHandle ? "Change Prompt Handle" : "Save Prompt"}
      onSubmit={() => void handleSubmit(submitCallback)()}
      note={
        <Controller
          name="scope"
          control={control}
          render={({ field }) => (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="outline" size="sm" px={2}>
                  {field.value === PromptScope.PROJECT ? (
                    <Users size={14} />
                  ) : (
                    <Building size={14} />
                  )}
                  <Text>{field.value === PromptScope.PROJECT ? "Project" : "Organization"}</Text>
                  <ChevronDown size={12} />
                </Button>
              </Menu.Trigger>
              <Menu.Content portalled={false}>
                <Menu.Item value="project" onClick={() => field.onChange(PromptScope.PROJECT)}>
                  <HStack gap={2}>
                    <Users size={14} />
                    <Text>Project</Text>
                  </HStack>
                  {field.value === PromptScope.PROJECT && <Check size={14} />}
                </Menu.Item>
                <Menu.Item
                  value="organization"
                  onClick={() => field.onChange(PromptScope.ORGANIZATION)}
                >
                  <HStack gap={2}>
                    <Building size={14} />
                    <Text>Organization</Text>
                  </HStack>
                  {field.value === PromptScope.ORGANIZATION && <Check size={14} />}
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          )}
        />
      }
      primaryAction={{
        label: "Save",
        type: "submit",
        tone: "success",
        loading: isSubmitting,
        "data-testid": "prompt-handle-submit",
      }}
    >
      <VStack width="full" gap={4}>
        {currentHandle && (
          <Text color="red.fg" textStyle="caption" fontWeight="medium" mb={2}>
            ⚠ Warning: Changing the prompt identifier or scope may break any existing integrations,
            API calls, or workflows that use &quot;
            {currentHandle}
            &quot;. Make sure to update all references in your codebase and documentation.
          </Text>
        )}
        <Field.Root invalid={!!errors.handle}>
          <Field.Label>Prompt identifier</Field.Label>
          <Input
            placeholder="prompt-name"
            data-testid="prompt-handle-input"

            data-1p-ignore
            {...handleHandler}
            onChange={(e) => {
              e.target.value = e.target.value
                .toLowerCase()
                .replace(/ /g, "-")
                .replace(/[^a-z0-9_\-/]/g, "");
              void handleHandler.onChange(e);
            }}
          />
          {errors.handle ? (
            <Field.ErrorText>{errors.handle.message?.toString()}</Field.ErrorText>
          ) : (
            <Field.HelperText paddingY={2}>
              {'e.g. "prompt-name" or "marketing/tone-of-voice"'}
            </Field.HelperText>
          )}
        </Field.Root>
      </VStack>
    </Dialog>
  );
}
