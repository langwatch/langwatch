import type { MouseEvent, ReactNode } from "react";

import type { ButtonVariant, ControlSize } from "./button.tsx";

export type IconButtonProps = {
  /** The accessible name and the hover title; an icon alone says nothing. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ControlSize;
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

export const IconButton = ({
  label,
  icon,
  variant = "ghost",
  size = "md",
  disabled = false,
  onClick,
}: IconButtonProps) => (
  <button
    type="button"
    className="ds-button"
    data-variant={variant}
    data-size={size}
    data-icon-only=""
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
  >
    {icon}
  </button>
);
