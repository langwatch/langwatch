import { useEffect, useRef, useState } from "react";

import type { ControlSize } from "./button.tsx";
import { flag } from "./class-names.ts";

export type ConfirmButtonProps = {
  /** The resting label: "Restart", "Stop", "Destroy". */
  label: string;
  /** The armed label, shown for the confirmation window. */
  confirmLabel?: string;
  onConfirm: () => void;
  variant?: "danger" | "secondary";
  size?: ControlSize;
  disabled?: boolean;
};

/** A first click arms the button; a second within this window confirms. */
export const CONFIRM_WINDOW_MS = 3000;

export const ConfirmButton = ({
  label,
  confirmLabel = "Confirm",
  onConfirm,
  variant = "danger",
  size = "md",
  disabled = false,
}: ConfirmButtonProps) => {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const disarm = () => {
    clearTimeout(timer.current);
    setArmed(false);
  };
  const press = () => {
    if (armed) {
      disarm();
      onConfirm();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
  };

  return (
    <button
      type="button"
      className="ds-button"
      data-variant={variant}
      data-size={size}
      data-armed={flag({ on: armed })}
      disabled={disabled}
      onClick={press}
      onKeyDown={(event) => {
        if (event.key === "Escape") disarm();
      }}
    >
      {/* Both labels share one cell, so arming never changes the width. */}
      <span className="ds-confirm-labels">
        <span aria-hidden={armed} data-hidden={flag({ on: armed })}>
          {label}
        </span>
        <span aria-hidden={!armed} data-hidden={flag({ on: !armed })}>
          {confirmLabel}
        </span>
      </span>
    </button>
  );
};
