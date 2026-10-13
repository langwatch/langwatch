import { useEffect, useId, useRef, type ReactNode } from "react";

import { IconButton } from "../controls/icon-button.tsx";
import { IconClose } from "../icons.tsx";

export type DialogProps = {
  open: boolean;
  /** Called on Escape and on the close button. */
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** The actions row: the primary action last. */
  footer?: ReactNode;
};

/** A modal on the native <dialog>, which brings the focus trap and Escape with it. */
export const Dialog = ({ open, onClose, title, description, children, footer }: DialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="ds-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        if (open) onClose();
      }}
    >
      <div className="ds-dialog-content">
        <div className="ds-dialog-header">
          <div className="ds-dialog-heading">
            <h2 className="ds-dialog-title" id={titleId}>
              {title}
            </h2>
            {description !== undefined && <p className="ds-dialog-description">{description}</p>}
          </div>
          <IconButton label="Close" icon={<IconClose />} size="sm" onClick={onClose} />
        </div>
        {children}
      </div>
      {footer !== undefined && <div className="ds-dialog-footer">{footer}</div>}
    </dialog>
  );
};
