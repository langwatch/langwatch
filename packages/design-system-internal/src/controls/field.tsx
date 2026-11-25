import type { ReactNode } from "react";

export type FieldText = {
  /** Always given; `hideLabel` keeps it for screen readers only. */
  label: string;
  hideLabel?: boolean;
  hint?: string;
  /** Marks the control invalid and says why. */
  error?: string;
};

/** The ids a control points `aria-describedby` at. */
export const describedBy = ({ id, hint, error }: { id: string; hint?: string; error?: string }) =>
  [hint === undefined ? "" : `${id}-hint`, error === undefined ? "" : `${id}-error`]
    .filter((part) => part.length > 0)
    .join(" ") || undefined;

export const Field = ({
  id,
  label,
  hideLabel = false,
  hint,
  error,
  children,
}: FieldText & { id: string; children: ReactNode }) => (
  <div className="ds-field">
    <label className={hideLabel ? "ds-visually-hidden" : "ds-field-label"} htmlFor={id}>
      {label}
    </label>
    {children}
    {hint !== undefined && (
      <span className="ds-field-hint" id={`${id}-hint`}>
        {hint}
      </span>
    )}
    {error !== undefined && (
      <span className="ds-field-error" id={`${id}-error`}>
        {error}
      </span>
    )}
  </div>
);
