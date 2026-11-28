import { CodePreview } from "@langwatch/design-system/code-preview";
import { Button, Field, HStack, VStack } from "@langwatch/design-system/primitives";
import { Plus, Trash2 } from "lucide-react";

import type { ConnectorBlockKind } from "../../model/connector-starters.ts";

const TITLE_BY_KIND: Record<ConnectorBlockKind, string> = {
  setup: "Setup",
  call: "Call",
  teardown: "Teardown",
};

const HELP_BY_KIND: Record<ConnectorBlockKind, string> = {
  setup: "Runs once before the first turn. Return { state, secrets? }.",
  call: "Runs every turn: send the message to your API and return { reply }.",
  teardown: "Runs once after the last turn, with the state setup returned.",
};

/** One block's code: a preview that opens the editor, or for an optional block an Add control. */
export function ConnectorBlockField({
  kind,
  code,
  isOptional,
  error,
  onAdd,
  onRemove,
  onEdit,
}: {
  kind: ConnectorBlockKind;
  code: string | null;
  isOptional: boolean;
  error: string | undefined;
  onAdd: () => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const title = TITLE_BY_KIND[kind];
  return (
    <Field.Root
      required={!isOptional}
      invalid={Boolean(error)}
      data-testid={`connector-block-${kind}`}
    >
      <Field.Label>{title}</Field.Label>
      <Field.HelperText>{HELP_BY_KIND[kind]}</Field.HelperText>
      {code === null ? (
        <Button size="xs" variant="outline" onClick={onAdd}>
          <Plus size={14} /> Add {title.toLowerCase()}
        </Button>
      ) : (
        <VStack align="stretch" gap={2} width="full">
          <CodePreview code={code} language="python" filename={`${kind}.py`} lineNumbers compact />
          <HStack gap={2}>
            <Button size="xs" variant="outline" onClick={onEdit}>
              Edit {title.toLowerCase()} code
            </Button>
            {isOptional && (
              <Button size="xs" variant="ghost" onClick={onRemove}>
                <Trash2 size={14} /> Remove {title.toLowerCase()}
              </Button>
            )}
          </HStack>
        </VStack>
      )}
      {error && <Field.ErrorText>{error}</Field.ErrorText>}
    </Field.Root>
  );
}
