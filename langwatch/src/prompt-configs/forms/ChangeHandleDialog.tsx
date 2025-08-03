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
  Portal,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { PromptScope } from "@prisma/client";
import { useCallback } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Dialog } from "~/components/ui/dialog";
import { usePromptHandleCheck } from "../../hooks/prompts/usePromptHandleCheck";
import { isValidHandle } from "../../server/prompt-config/repositories/llm-config-version-schema";
import type { LlmConfigWithLatestVersion } from "../../server/prompt-config/repositories";
import { LuBuilding, LuLock } from "react-icons/lu";
import { Select } from "../../components/ui/select";

const changeHandleFormSchema = z.object({
  handle: z
    .string()
    .nonempty()
    .refine(
      (value) => {
        if (!value || value.trim() === "") return true;
        return isValidHandle(value);
      },
      {
        message:
          "Handle should be in the 'identifier' or 'namespace/identifier' format. Only lowercase letters, numbers, hyphens, underscores and up to one slash are allowed.",
      }
    ),
  scope: z.nativeEnum(PromptScope).default("PROJECT"),
});

/**
 * Creates a prompt config schema with the handle field
 * that is validated against the server side uniqueness check.
 *
 * @param params - The parameters for the schema creation.
 * @returns The prompt config schema.
 */
export const createPromptConfigSchemaWithValidators = (params: {
  configId: string;
  checkHandleUniqueness: (params: {
    handle: string;
    scope: PromptScope;
    excludeId?: string;
  }) => Promise<boolean>;
}) => {
  const { configId, checkHandleUniqueness } = params;

  return changeHandleFormSchema.superRefine(async (data, ctx) => {
    if (!data.handle || data.handle.trim() === "") return;
    if (!isValidHandle(data.handle)) return;

    const isUnique = await checkHandleUniqueness({
      handle: data.handle,
      scope: data.scope,
      excludeId: configId,
    });

    if (!isUnique) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `⚠ Prompt "${String(
          data.handle
        )}" already exists on the ${data.scope.toLowerCase()}.`,
        path: ["handle"],
      });
    }
  });
};

export type ChangeHandleDialogFormValues = {
  handle: string;
  scope: PromptScope;
  commitMessage: string;
};

export interface ChangeHandleDialogProps {
  config: LlmConfigWithLatestVersion;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ChangeHandleDialogFormValues) => Promise<void>;
  firstTimeSave: boolean;
}

export function ChangeHandleDialog({
  config,
  isOpen,
  onClose,
  onSubmit,
  firstTimeSave,
}: ChangeHandleDialogProps) {
  const { checkHandleUniqueness } = usePromptHandleCheck();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    control,
  } = useForm<z.infer<typeof changeHandleFormSchema>>({
    defaultValues: {
      handle: firstTimeSave ? "" : config.handle ?? "",
      scope: config.scope ?? "PROJECT",
    },
    resolver: zodResolver(
      createPromptConfigSchemaWithValidators({
        configId: config.id,
        checkHandleUniqueness,
      })
    ),
  });

  const submitCallback = useCallback(
    async (data: z.infer<typeof changeHandleFormSchema>) => {
      await onSubmit({
        handle: data.handle,
        scope: data.scope,
        commitMessage: firstTimeSave
          ? `Created prompt ${data.handle}`
          : `Renamed prompt to ${data.handle}`,
      });
      reset();
    },
    [onSubmit, reset, firstTimeSave]
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
      { label: "Project", value: "PROJECT", icon: <LuLock /> },
      { label: "Organization", value: "ORGANIZATION", icon: <LuBuilding /> },
    ],
  });

  const ScopeSelectTrigger = () => {
    const select = useSelectContext();

    return (
      <Button px="2" variant="outline" size="sm" {...select.getTriggerProps()}>
        {select.selectedItems[0]?.value === "PROJECT" ? (
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
              {firstTimeSave ? "Save Prompt" : "Change Prompt ID"}
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <VStack width="full" gap={4}>
              <Field.Root invalid={!!errors.handle}>
                <Field.Label>Prompt Identifier</Field.Label>
                <Input
                  placeholder="prompt-name"
                  autoFocus
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
                          {scope.value === "PROJECT" ? (
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
