// Smoke-test v3 — DO NOT MERGE. Save button disabled on !isValid
// (design/guidelines.md § 6 + ADR-018).

import React from "react";

export function CreateThing({ form, mutation }: { form: { formState: { isValid: boolean } }; mutation: { isPending: boolean } }) {
  return (
    <form>
      {/* VIOLATION: disable on !form.formState.isValid. */}
      <button type="submit" disabled={!form.formState.isValid}>Save</button>
    </form>
  );
}
