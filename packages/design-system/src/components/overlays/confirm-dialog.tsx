import type { ReactNode } from "react";

import { Dialog } from "./dialog.tsx";

type ConfirmClose =
  | { onClose: () => void; onOpenChange?: never }
  /** @deprecated Pass `onClose`; `onOpenChange` goes in W-final. */
  | { onOpenChange: (open: boolean) => void; onClose?: never };

type ConfirmText =
  | { description: ReactNode; message?: never }
  /** @deprecated Pass `description`; `message` goes in W-final. */
  | { message: string; description?: never };

export type ConfirmDialogProps = ConfirmClose &
  ConfirmText & {
    open: boolean;
    onConfirm: () => void;
    /** "Revoke API key?", never "Are you sure?". */
    title: string;
    /** The verb; default "Confirm". */
    confirmLabel?: string;
    /** `danger` paints the confirm red. `warning` is deprecated and reads as `default`. */
    tone?: "danger" | "default" | "warning";
    loading?: boolean;
    /** At most one extra field: a reason, a checkbox. */
    children?: ReactNode;
    /** Where focus goes when it closes, asked at that moment; omitted, back to the opener. */
    finalFocusEl?: () => HTMLElement | null;
    /** Runs once, after the dialog has left the screen: clean up what it was about. */
    onExitComplete?: () => void;
  };

/** The one confirmation dialog for an action that needs a second thought. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    open,
    title,
    confirmLabel = "Confirm",
    tone = "danger",
    loading = false,
    onConfirm,
    children,
    finalFocusEl,
    onExitComplete,
  } = props;
  const onClose = props.onClose ?? (() => props.onOpenChange?.(false));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={props.description ?? props.message}
      role={tone === "danger" ? "alertdialog" : "dialog"}
      busy={loading}
      finalFocusEl={finalFocusEl}
      onExitComplete={onExitComplete}
      primaryAction={{
        label: confirmLabel,
        onClick: onConfirm,
        loading,
        danger: tone === "danger",
      }}
    >
      {children}
    </Dialog>
  );
}
