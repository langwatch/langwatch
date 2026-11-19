/** Adds a hostname to a private endpoint, or changes a binding's hostname or endpoint. */
import { Dialog } from "@langwatch/design-system/dialog";
import { Field, Input, NativeSelect, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useState } from "react";

import type { BindingFieldErrors } from "../../model/private-endpoint-bindings.ts";

export type BindingDraft = { endpointId: string; hostname: string };

const FORM_ID = "private-endpoint-binding-form";

export function BindingDialog({
  open,
  title,
  submitLabel,
  endpoints,
  initial,
  errors,
  loading,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  endpoints: readonly { id: string; name: string; region: string }[];
  initial: BindingDraft;
  errors: BindingFieldErrors;
  loading: boolean;
  onSubmit: (draft: BindingDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BindingDraft>(initial);

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description="Use the hostname your TLS certificate covers. Then set the model provider's base URL to https://<hostname>."
      formId={FORM_ID}
      onSubmit={() => onSubmit({ endpointId: draft.endpointId, hostname: draft.hostname.trim() })}
      busy={loading}
      primaryAction={{ label: submitLabel, type: "submit", loading }}
    >
      <VStack gap={4} align="stretch">
        <Field.Root>
          <Field.Label>Private endpoint</Field.Label>
          <NativeSelect.Root size="sm" width="full">
            <NativeSelect.Field
              value={draft.endpointId}
              onChange={(event) => setDraft({ ...draft, endpointId: event.target.value })}
            >
              {endpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.name} ({endpoint.region})
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>
        <Field.Root invalid={!!errors.hostname}>
          <Field.Label>Hostname</Field.Label>
          <Input
            value={draft.hostname}
            onChange={(event) => setDraft({ ...draft, hostname: event.target.value })}
            placeholder="llm.internal.example.com"
            autoComplete="off"
          />
          {errors.hostname && <Field.ErrorText>{errors.hostname}</Field.ErrorText>}
        </Field.Root>
      </VStack>
    </Dialog>
  );
}
