import { Field, Input } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { useAutomationStore } from "../state/automationStore";
import { useConfigComplete, useDraft, usePresetLabels } from "../state/selectors";

/** Per-preset placeholder — a concrete example beats an empty field. */
const NAME_PLACEHOLDER = {
  trace: "Flag failing traces",
  customGraph: "High latency alert",
  report: "Weekly quality digest",
} as const;

/**
 * The Name facet (ADR-043 facet 1). Full-width and first in the flow —
 * the rule's primary identity, mirroring every modern automation builder
 * (Linear, Sentry, Datadog, Zapier). Reads and writes the draft through
 * the store, so it takes no props.
 */
export function NameField({ isEdit }: { isEdit: boolean }) {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const configComplete = useConfigComplete();
  const { noun } = usePresetLabels(isEdit);
  // Only flag the missing name once the rest of the setup is done — a fresh
  // draft shouldn't open with a red field, but a fully-configured draft that
  // can't save needs the reason pointed at, not hidden.
  const nameMissing = draft.name.trim().length === 0 && configComplete;

  // Land the cursor on the name when the drawer opens — it's the first thing
  // the author fills. A frame's delay lets the drawer's own focus trap settle
  // first so ours wins.
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
        value={draft.name}
        onChange={(e) => dispatch({ type: "SET_NAME", value: e.target.value })}
        placeholder={NAME_PLACEHOLDER[draft.source]}
      />
      {nameMissing ? (
        <Field.ErrorText>Name this {noun} to save it.</Field.ErrorText>
      ) : null}
    </Field.Root>
  );
}
