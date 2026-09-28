/**
 * A text field that edits a value in place: it takes focus when it appears,
 * Enter or leaving it commits, Escape cancels.
 */

import { Input, type InputProps } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

export function InlineTextField({
  value,
  label,
  placeholder,
  onCommit,
  onCancel,
  ...inputProps
}: {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
} & Pick<InputProps, "fontSize" | "fontWeight" | "size" | "maxWidth">) {
  const [draft, setDraft] = useState(value);
  // Enter settles the field and the blur that follows must not settle it twice.
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    onCommit(draft);
  };

  return (
    <Input
      ref={inputRef}
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          settled.current = true;
          onCancel();
        }
      }}
      {...inputProps}
    />
  );
}
