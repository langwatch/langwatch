/** Confirm for destructive actions, on the design-system Dialog. Takes an arbitrary child
 * (typed-confirmation inputs, pickers) and, optionally, a form the caller validates. */

import { Dialog } from "@langwatch/design-system/dialog";
import type { ReactNode } from "react";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  onSubmit,
  formId,
  title,
  description,
  isLoading,
  children,
  disabledReason,
  confirmDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  /** A button-only confirm. Not called while a request is in flight. */
  onConfirm: () => void;
  /**
   * The dialog owns a form and Confirm submits it, so Enter and a click reach one validator. The
   * handler validates, shows its own errors and mutates nothing when invalid.
   */
  onSubmit?: () => void;
  /**
   * With `onSubmit`, the id of the dialog's own form. Alone, the id of a form the children own:
   * Confirm submits that form and no second form is made.
   */
  formId?: string;
  title: string;
  description: string;
  isLoading: boolean;
  /**
   * Optional extra input rendered under the description. Used where confirming
   * should take deliberate effort rather than one click, e.g. typing the name
   * of what is about to be destroyed.
   */
  children?: ReactNode;
  /** Why Confirm is unavailable: a typed acknowledgement not yet matching, a missing permission. */
  disabledReason?: string;
  /**
   * @deprecated Held for callers that gate on missing input; the owner moves them to
   * validation on submit. Until then Confirm shows a generic reason.
   */
  confirmDisabled?: boolean;
}) {
  const reason =
    disabledReason ?? (confirmDisabled ? "Complete the field above to confirm." : void 0);
  const ownsForm = onSubmit !== undefined;
  const childForm = !ownsForm && formId !== undefined;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      role="alertdialog"
      busy={isLoading}
      onSubmit={ownsForm ? () => (isLoading ? void 0 : onSubmit()) : void 0}
      formId={ownsForm ? formId : void 0}
      primaryAction={
        ownsForm || childForm
          ? {
              label: "Confirm",
              type: "submit",
              form: childForm ? formId : void 0,
              loading: isLoading,
              danger: true,
              disabledReason: reason,
            }
          : {
              label: "Confirm",
              onClick: () => {
                if (!isLoading) onConfirm();
              },
              loading: isLoading,
              danger: true,
              disabledReason: reason,
            }
      }
    >
      {children}
    </Dialog>
  );
}
