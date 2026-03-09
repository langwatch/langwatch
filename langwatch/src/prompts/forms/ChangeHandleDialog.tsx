import {
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { PromptScope } from "@prisma/client";
import { useCallback, useEffect } from "react";
import { Controller, type Resolver, useForm } from "react-hook-form";
import { Building, Check, ChevronDown, Users } from "lucide-react";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
import { usePromptHandleCheck } from "../../hooks/prompts/usePromptHandleCheck";
import {
  type ChangeHandleFormValues,
  createChangeHandleFormSchema,
} from "./schemas/change-handle-form.schema";

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
    formState: { errors, isSubmitting, isDirty },
    reset,
    control,
  } = useForm<ChangeHandleFormValues>({
    defaultValues: {
      handle,
      scope: scope,
    },
    resolver: zodResolver(
      createChangeHandleFormSchema({ checkHandleUniqueness }),
    ) as Resolver<ChangeHandleFormValues>,
  });

  /**
   * Reset the form values when the component mounts.
   */
  useEffect(() => {
    reset({
      handle,
      scope: scope,
    });
  }, [handle, scope, reset]);

  /**
   * Submit the form values when the form is submitted.
   */
  const submitCallback = useCallback(
    async (data: ChangeHandleFormValues) => {
      await onSubmit({
        handle: data.handle,
        scope: data.scope,
      });
      reset();
    },
    [onSubmit, reset],
  );

  const handleHandler = register("handle", {
    required: "Prompt identifier is required",
  });

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <Dialog.Content>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit(submitCallback)();
          }}
        >
          <Dialog.Header>
            <Dialog.Title>
              {currentHandle ? "Change Prompt Handle" : "Save Prompt"}
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <VStack width="full" gap={4}>
              {currentHandle && (
                <Text color="red.fg" fontSize="12px" fontWeight="medium" mb={2}>
                  ⚠ Warning: Changing the prompt identifier or scope may break
                  any existing integrations, API calls, or workflows that use
                  &quot;
                  {currentHandle}
                  &quot;. Make sure to update all references in your codebase
                  and documentation.
                </Text>
              )}
              <Field.Root invalid={!!errors.handle}>
                <Field.Label>Prompt Identifier</Field.Label>
                <Input
                  placeholder="prompt-name"
                  autoFocus
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
                  <Field.ErrorText>
                    {errors.handle.message?.toString()}
                  </Field.ErrorText>
                ) : (
                  <Field.HelperText paddingY={2}>
                    {'e.g. "prompt-name" or "marketing/tone-of-voice"'}
                  </Field.HelperText>
                )}
              </Field.Root>
            </VStack>
          </Dialog.Body>
          <Dialog.Footer>
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
                      <Text>
                        {field.value === PromptScope.PROJECT
                          ? "Project"
                          : "Organization"}
                      </Text>
                      <ChevronDown size={12} />
                    </Button>
                  </Menu.Trigger>
                  <Menu.Content portalled={false}>
                    <Menu.Item
                      value="project"
                      onClick={() => field.onChange(PromptScope.PROJECT)}
                    >
                      <HStack gap={2}>
                        <Users size={14} />
                        <Text>Project</Text>
                      </HStack>
                      {field.value === PromptScope.PROJECT && (
                        <Check size={14} />
                      )}
                    </Menu.Item>
                    <Menu.Item
                      value="organization"
                      onClick={() => field.onChange(PromptScope.ORGANIZATION)}
                    >
                      <HStack gap={2}>
                        <Building size={14} />
                        <Text>Organization</Text>
                      </HStack>
                      {field.value === PromptScope.ORGANIZATION && (
                        <Check size={14} />
                      )}
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Root>
              )}
            />
            <Spacer />
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="green"
              onClick={() => void handleSubmit(submitCallback)()}
              loading={isSubmitting}
              disabled={!isDirty}
            >
              Save
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
