import { useEffect, useRef, useState } from "react";

import { writeClipboardText } from "../clipboard.ts";
import type { ControlSize } from "./button.tsx";
import { flag } from "./class-names.ts";
import { IconCheck, IconCopy } from "./icons.tsx";

export type CopyButtonProps = {
  value: string;
  /** The idle name, e.g. "Copy hostname". */
  label?: string;
  size?: ControlSize;
  /** Show the words beside the icon, not just as the name. */
  showLabel?: boolean;
};

type CopyState = "idle" | "copied" | "failed";

/** How long "Copied" stays before the button reads as a copy button again. */
export const COPY_FEEDBACK_MS = 1500;

export const CopyButton = ({
  value,
  label = "Copy",
  size = "sm",
  showLabel = false,
}: CopyButtonProps) => {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = ({ next }: { next: CopyState }) => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
  };
  const copy = () => {
    void writeClipboardText({ text: value })
      .then(() => settle({ next: "copied" }))
      .catch(() => settle({ next: "failed" }));
  };

  const name = { idle: label, copied: "Copied", failed: "Copy failed" }[state];
  return (
    <button
      type="button"
      className="ds-button"
      data-variant="ghost"
      data-size={size}
      data-icon-only={flag({ on: !showLabel })}
      aria-label={name}
      title={name}
      onClick={copy}
    >
      {state === "copied" ? <IconCheck /> : <IconCopy />}
      {showLabel && name}
      <output className="ds-visually-hidden">{state === "idle" ? "" : name}</output>
    </button>
  );
};
