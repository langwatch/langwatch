import { useEffect } from "react";
import type { z } from "zod";

import type { suiteFormSchema } from "../../model/suite/suite-form.types.ts";
import type { useSuiteForm } from "../suite/use-suite-form.ts";

type SuiteFormValues = z.input<typeof suiteFormSchema>;

/** Half-filled run plans, held while the suite drawer hands over to another drawer and back. */
const drafts = new Map<string, SuiteFormValues>();

const draftKey = (suiteId: string | undefined) => `suiteEditor:${suiteId ?? "new"}`;

/** Holds the plan the suite drawer at this address was editing, until it comes back. */
export function holdSuiteFormDraft({
  suiteId,
  values,
}: {
  suiteId: string | undefined;
  values: SuiteFormValues;
}) {
  drafts.set(draftKey(suiteId), values);
}

/** Hands a held plan back to the suite drawer at this address, once, and forgets it. */
export function restoreSuiteFormDraft({
  suiteId,
  restore,
}: {
  suiteId: string | undefined;
  restore: (values: SuiteFormValues) => void;
}) {
  const key = draftKey(suiteId);
  const draft = drafts.get(key);
  if (!draft) return;
  drafts.delete(key);
  restore(draft);
}

/**
 * The suite drawer's draft: what it holds before handing over to a sub-drawer, restored once it
 * is open again and its suite has loaded. Call after `useSuiteForm`, so the restore wins its reset.
 */
export function useSuiteFormDraft({
  form,
  isOpen,
  suiteId,
  suiteLoaded,
}: {
  form: ReturnType<typeof useSuiteForm>["form"];
  isOpen: boolean;
  suiteId: string | undefined;
  suiteLoaded: boolean;
}) {
  const ready = isOpen && (!suiteId || suiteLoaded);
  useEffect(() => {
    if (!ready) return;
    restoreSuiteFormDraft({ suiteId, restore: (values) => form.reset(values) });
  }, [form, ready, suiteId]);

  return { holdDraft: () => holdSuiteFormDraft({ suiteId, values: form.getValues() }) };
}
