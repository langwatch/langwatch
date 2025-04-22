import { Button, Field, Input, Spinner } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { SaveIcon } from "lucide-react";
import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Dialog } from "~/components/ui/dialog";

const saveVersionFormSchema = z.object({
  commitMessage: z.string().min(1, "Commit message is required"),
});

export type SaveDialogFormValues = {
  commitMessage: string;
};

export function SaveVersionDialog({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SaveDialogFormValues) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<SaveDialogFormValues>({
    defaultValues: {
      commitMessage: "",
    },
    resolver: zodResolver(saveVersionFormSchema),
  });

  const submitCallback = useCallback(
    async (data: SaveDialogFormValues) => {
      await onSubmit(data);
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
        <Dialog.Header>Save Version</Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body>
          <form onSubmit={() => void handleSubmit(submitCallback)()}>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Input
                placeholder="Enter a description for this version"
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
            {isSubmitting ? <Spinner /> : <SaveIcon />}
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
