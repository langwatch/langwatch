import { Field, Input } from "@chakra-ui/react";
import { useEffect, useRef } from "react";

const NAME_PLACEHOLDER = {
  trace: "Flag failing traces",
  customGraph: "High latency alert",
  report: "Weekly quality digest",
} as const;

/** Controlled identity field shared by the authoring host and browser shells. */
export function AutomationNameField({
  source,
  value,
  isEdit,
  configComplete,
  noun,
  onChange,
}: {
  source: keyof typeof NAME_PLACEHOLDER;
  value: string;
  isEdit: boolean;
  configComplete: boolean;
  noun: string;
  onChange: (value: string) => void;
}) {
  const nameMissing = value.trim().length === 0 && configComplete;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Field.Root invalid={nameMissing}>
      <Field.Label>Name</Field.Label>
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={NAME_PLACEHOLDER[source]}
      />
      {nameMissing ? <Field.ErrorText>Name this {noun} to save it.</Field.ErrorText> : null}
    </Field.Root>
  );
}
