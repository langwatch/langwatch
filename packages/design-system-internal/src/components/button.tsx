import type { MouseEvent, ReactNode } from "react";

import { flag } from "./class-names.ts";
import { Spinner } from "./icons.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "sm" | "md";

export type ButtonProps = {
  children: ReactNode;
  /** `primary` is the one orange action in a view. */
  variant?: ButtonVariant;
  size?: ControlSize;
  /** Keeps the width, shows a spinner and refuses clicks. */
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** An icon before the label. */
  icon?: ReactNode;
  /** Renders a link that looks like a button. */
  href?: string;
  title?: string;
  form?: string;
};

export const Button = ({
  children,
  variant = "secondary",
  size = "md",
  loading = false,
  disabled = false,
  type = "button",
  onClick,
  icon,
  href,
  title,
  form,
}: ButtonProps) => {
  const label = (
    <span className="ds-button-label">
      {icon}
      {children}
    </span>
  );
  if (href !== undefined) {
    return (
      <a className="ds-button" data-variant={variant} data-size={size} href={href} title={title}>
        {label}
      </a>
    );
  }
  return (
    <button
      type={type}
      className="ds-button"
      data-variant={variant}
      data-size={size}
      data-loading={flag({ on: loading })}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      onClick={onClick}
      title={title}
      form={form}
    >
      {label}
      {loading && <Spinner />}
    </button>
  );
};
