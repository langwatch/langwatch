import { Button, Field, Input } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Dialog } from "~/components/ui/dialog";

const saveVersionFormSchema = z.object({
  commitMessage: z.string().trim().min(1, "Commit message is required"),
});

export type SaveDialogFormValues = {
  commitMessage: string;
  saveNewVersion: boolean;
};

export interface SaveVersionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SaveDialogFormValues) => Promise<void>;
}

export function SaveVersionDialog({
  isOpen,
  onClose,
  onSubmit,
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
    [onSubmit, reset]
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
      <Dialog.Backdrop />
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Save Version</Dialog.Title>
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
                {...register("commitMessage", {
                  required: "Description is required",
                })}
              />
              {errors.commitMessage && (
                <Field.ErrorText>
                  {errors.commitMessage.message?.toString()}
                </Field.ErrorText>
              )}
            </Field.Root>
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" mr={3} onClick={onClose}>
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
      </Dialog.Content>
    </Dialog.Root>
  );
}
