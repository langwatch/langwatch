import { Button, Dialog, Input } from "@langwatch/design-system-internal";
import { useState } from "react";

export type ResetDialogProps = {
  /** The Postgres database name, typed out to confirm: `haven db reset` asks the same. */
  database: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/** Reset drops and rebuilds the stack's databases, so it waits for the database name typed out. */
export const ResetDialog = ({ database, open, onClose, onConfirm }: ResetDialogProps) => {
  const [typed, setTyped] = useState("");
  const close = () => {
    setTyped("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Reset this stack's databases?"
      description="This drops the stack's Postgres, ClickHouse and Redis data, then migrates and seeds them fresh. It cannot be undone."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="danger"
            disabled={typed !== database}
            onClick={() => {
              onConfirm();
              close();
            }}
          >
            Reset databases
          </Button>
        </>
      }
    >
      <Input
        label={`Type ${database} to confirm`}
        value={typed}
        onChange={setTyped}
        mono
        autoComplete="off"
      />
    </Dialog>
  );
};
