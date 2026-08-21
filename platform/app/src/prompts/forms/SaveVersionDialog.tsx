import { Button, Field, Input } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Dialog } from "~/components/ui/dialog";

const saveVersionFormSchema = z.object({
  commitMessage: z
    .string()
    .trim()
    .min(1, "Commit message is required")
    .max(200, "Commit message must be 200 characters or less"),
});

export type SaveDialogFormValues = {
  commitMessage: string;
  saveNewVersion: boolean;
};

export interface SaveVersionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SaveDialogFormValues) => Promise<void>;
  /** The version number these changes will be saved as, shown as helper text. */
  nextVersion?: number;
}

export function SaveVersionDialog({
  isOpen,
  onClose,
  onSubmit,
  nextVersion,
}: SaveVersionDialogProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<z.infer<typeof saveVersionFormSchema>>({
    defaultValues: {
      commitMessage: "",
    },
    resolver: zodResolver(saveVersionFormSchema),
  });

  const submitCallback = useCallback(
    async (data: z.infer<typeof saveVersionFormSchema>) => {
      await onSubmit({
        commitMessage: data.commitMessage,
        saveNewVersion: true,
      });
      reset();
    },
    [onSubmit, reset],
  );

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
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>Save changes</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit(submitCallback)();
            }}
          >
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Input
                placeholder="Enter a description for this version"
                autoFocus
                maxLength={200}
                {...register("commitMessage", {
                  required: "Description is required",
                })}
              />
              {errors.commitMessage ? (
                <Field.ErrorText>
                  {errors.commitMessage.message?.toString()}
                </Field.ErrorText>
              ) : (
                nextVersion !== undefined && (
                  // The version number is the result of saving, so it reads as
                  // supporting detail here rather than as the button's label.
                  <Field.HelperText>
                    Saves as version {nextVersion}
                  </Field.HelperText>
                )
              )}
            </Field.Root>
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="green"
            onClick={() => void handleSubmit(submitCallback)()}
            loading={isSubmitting}
            disabled={!isDirty}
          >
            Save changes
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
