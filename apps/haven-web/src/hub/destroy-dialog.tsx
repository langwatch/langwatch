import { Button, Dialog, Input } from "@langwatch/design-system-internal";
import { useState } from "react";

export type DestroyDialogProps = {
  slug: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/** Destroy drops databases, so it waits for the slug typed out: `haven destroy <slug>`. */
export const DestroyDialog = ({ slug, open, onClose, onConfirm }: DestroyDialogProps) => {
  const [typed, setTyped] = useState("");
  const close = () => {
    setTyped("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Destroy ${slug}?`}
      description="This stops the stack and drops its databases. It cannot be undone. The worktree stays."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="danger"
            disabled={typed !== slug}
            onClick={() => {
              onConfirm();
              close();
            }}
          >
            Destroy stack
          </Button>
        </>
      }
    >
      <Input
        label={`Type ${slug} to confirm`}
        value={typed}
        onChange={setTyped}
        mono
        autoComplete="off"
      />
    </Dialog>
  );
};
