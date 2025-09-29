import {
  Button,
  createListCollection,
  Field,
  Input,
  Spacer,
  useSelectContext,
  VStack,
  Text,
  HStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { PromptScope } from "@prisma/client";
import { useCallback, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { LuBuilding, LuLock } from "react-icons/lu";

import { Select } from "../../components/ui/select";
import { usePromptHandleCheck } from "../../hooks/prompts/usePromptHandleCheck";

import { createChangeHandleFormSchema, type ChangeHandleFormValues } from "./schemas/change-handle-form.schema";

import { Dialog } from "~/components/ui/dialog";

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
      createChangeHandleFormSchema({ checkHandleUniqueness })
    ),
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
    [onSubmit, reset]
  );

  const handleHandler = register("handle", {
    required: "Prompt identifier is required",
  });

  const scopesCollection = createListCollection<{
    label: string;
    value: PromptScope;
    icon: React.ReactNode;
  }>({
    items: [
      { label: "Project", value: PromptScope.PROJECT, icon: <LuLock /> },
      { label: "Organization", value: PromptScope.ORGANIZATION, icon: <LuBuilding /> },
    ],
  });

  const ScopeSelectTrigger = () => {
    const select = useSelectContext();

    return (
      <Button px="2" variant="outline" size="sm" {...select.getTriggerProps()}>
        {select.selectedItems[0]?.value === PromptScope.PROJECT ? (
          <LuLock />
        ) : (
          <LuBuilding />
        )}
        <Text>{select.selectedItems[0]?.label}</Text>
        <Select.Indicator />
      </Button>
    );
  };

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
      <Dialog.Backdrop />
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
                <Text
                  color="red.500"
                  fontSize="12px"
                  fontWeight="medium"
                  mb={2}
                >
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
                <Select.Root
                  zIndex="popover"
                  collection={scopesCollection}
                  width="100px"
                  {...field}
                  value={[field.value]}
                  onValueChange={(change) => {
                    field.onChange(change.value[0]);
                  }}
                >
                  <Select.HiddenSelect />
                  <Select.Control>
                    <ScopeSelectTrigger />
                  </Select.Control>
                  <Select.Content width="160px" zIndex="popover">
                    {scopesCollection.items.map((scope) => (
                      <Select.Item item={scope} key={scope.value}>
                        <HStack gap={2}>
                          {scope.value === PromptScope.PROJECT ? (
                            <LuLock />
                          ) : (
                            <LuBuilding />
                          )}
                          <Text>{scope.label}</Text>
                        </HStack>
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
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
