import { Field, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { useState } from "react";

import { CodeEditorModalHost } from "../../../../ui/elements/workflow/code/code-editor-modal-host.tsx";
import { WorkflowCodeEditorModal } from "../../../../ui/elements/workflow/code/workflow-code-editor.tsx";
import type {
  ConnectorDatasetOption,
  ConnectorForm,
  ConnectorFormErrors,
} from "../../model/connector-form.ts";
import {
  BLOCK_INPUTS,
  BLOCK_OUTPUTS_BY_KIND,
  STARTER_BY_KIND,
  type ConnectorBlockKind,
} from "../../model/connector-starters.ts";
import { ConnectorBlockField } from "./connector-block-field.tsx";
import { ConnectorSecretsField } from "./connector-secrets-field.tsx";
import { ConnectorDatasetField, ConnectorTimeoutField } from "./connector-settings-fields.tsx";

const CODE_KEY_BY_KIND = {
  setup: "setupCode",
  call: "callCode",
  teardown: "teardownCode",
} as const satisfies Record<ConnectorBlockKind, keyof ConnectorForm>;

const BLOCK_KINDS: readonly ConnectorBlockKind[] = ["setup", "call", "teardown"];

const NO_OUTPUTS: (typeof BLOCK_OUTPUTS_BY_KIND)[ConnectorBlockKind] = [];

/** Null removes an optional block; the call block is never removed. */
function codeChange(kind: ConnectorBlockKind, code: string | null): Partial<ConnectorForm> {
  switch (kind) {
    case "setup":
      return { setupCode: code };
    case "teardown":
      return { teardownCode: code };
    case "call":
      return { callCode: code ?? "" };
  }
}

/** The connector's fields; one code editor is open at a time, over the drawer. */
export function ConnectorAgentForm({
  form,
  errors,
  onChange,
  projectId,
  projectSecretNames,
  datasets,
}: {
  form: ConnectorForm;
  errors: ConnectorFormErrors;
  onChange: (values: Partial<ConnectorForm>) => void;
  projectId: string;
  projectSecretNames: readonly string[];
  datasets: readonly ConnectorDatasetOption[];
}) {
  const [editing, setEditing] = useState<ConnectorBlockKind | null>(null);
  const codeOf = (kind: ConnectorBlockKind) => form[CODE_KEY_BY_KIND[kind]];
  const setCode = (kind: ConnectorBlockKind, code: string | null) =>
    onChange(codeChange(kind, code));

  return (
    <VStack gap={5} align="stretch" flex={1} overflowY="auto" paddingX={6} paddingY={4}>
      <Field.Root required invalid={Boolean(errors.name)}>
        <Field.Label>Name</Field.Label>
        <Input
          value={form.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Enter agent name"
          data-testid="connector-agent-name-input"
        />
        {errors.name && <Field.ErrorText>{errors.name}</Field.ErrorText>}
      </Field.Root>

      {BLOCK_KINDS.map((kind) => (
        <ConnectorBlockField
          key={kind}
          kind={kind}
          code={codeOf(kind)}
          isOptional={kind !== "call"}
          error={errors[kind]}
          onAdd={() => setCode(kind, STARTER_BY_KIND[kind])}
          onRemove={() => setCode(kind, null)}
          onEdit={() => setEditing(kind)}
        />
      ))}

      <ConnectorSecretsField
        projectSecretNames={projectSecretNames}
        secretNames={form.secretNames}
        error={errors.secretNames}
        onChange={(secretNames) => onChange({ secretNames })}
      />
      <ConnectorDatasetField
        datasets={datasets}
        fixturesDatasetId={form.fixturesDatasetId}
        onChange={(fixturesDatasetId) => onChange({ fixturesDatasetId })}
      />
      <ConnectorTimeoutField
        timeoutSeconds={form.timeoutSeconds}
        error={errors.timeoutMs}
        onChange={(timeoutSeconds) => onChange({ timeoutSeconds })}
      />
      {errors.config && (
        <Text textStyle="bodySm" color="fg.error" role="alert">
          {errors.config}
        </Text>
      )}

      <WorkflowCodeEditorModal
        code={editing ? (codeOf(editing) ?? "") : ""}
        setCode={(code) => {
          if (editing) setCode(editing, code);
        }}
        open={editing !== null}
        onClose={() => setEditing(null)}
        inputs={BLOCK_INPUTS}
        outputs={editing ? BLOCK_OUTPUTS_BY_KIND[editing] : NO_OUTPUTS}
        secretNames={form.secretNames}
        renderModal={CodeEditorModalHost}
        {...(projectId ? { projectId } : {})}
      />
    </VStack>
  );
}
