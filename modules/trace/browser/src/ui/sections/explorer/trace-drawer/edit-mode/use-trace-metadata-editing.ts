import {
  traceAttributeKeyForMetadata,
  mapAttributeToTraceMetadataKey,
} from "@langwatch/trace-contract";
import { useCallback, useMemo } from "react";

import {
  selectTraceMetadataBaseline,
  useTraceEditStore,
} from "../../../../../behavior/trace-edit.store.ts";
import type { AttributeEditing } from "../attribute-table.tsx";

type StoredMetadata = NonNullable<
  NonNullable<ReturnType<typeof useTraceEditStore.getState>["basePatch"]>["trace"]
>["metadata"];

/**
 * The captured attributes with a stored correction laid over them: none stored
 * keeps them, a cleared correction empties them, and a null value removes a key.
 */
function attributesWithStoredMetadata({
  capturedAttributes,
  stored,
}: {
  capturedAttributes: Record<string, unknown>;
  stored: StoredMetadata;
}): Record<string, unknown> {
  if (stored === undefined) return capturedAttributes;
  if (stored === null) return {};
  const next = { ...capturedAttributes };
  for (const [key, value] of Object.entries(stored)) {
    const attributeKey = traceAttributeKeyForMetadata(key);
    if (value === null) delete next[attributeKey];
    else next[attributeKey] = value;
  }
  return next;
}

/** The captured attributes that are trace metadata, under their metadata keys. */
function metadataOfAttributes(
  capturedAttributes: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(capturedAttributes).flatMap(([attributeKey, value]) => {
      const key = mapAttributeToTraceMetadataKey(attributeKey);
      return key === null ? [] : [[key, value]];
    }),
  );
}

/**
 * Connects the summary's metadata table to the draft.
 */
export function useTraceMetadataEditing({
  capturedAttributes,
  enabled,
}: {
  capturedAttributes: Record<string, unknown>;
  enabled: boolean;
}): {
  /** The rows to render: captured, with a stored correction laid over them. */
  baselineAttributes: Record<string, unknown>;
  editing: AttributeEditing | undefined;
} {
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const drafts = useTraceEditStore((s) => s.traceMetadataDrafts);
  const setTraceMetadata = useTraceEditStore((s) => s.setTraceMetadata);
  const resetTraceMetadata = useTraceEditStore((s) => s.resetTraceMetadata);

  const baselineAttributes = useMemo(
    () => attributesWithStoredMetadata({ capturedAttributes, stored: basePatch?.trace?.metadata }),
    [basePatch, capturedAttributes],
  );
  const baselineMetadata = useMemo(
    () =>
      selectTraceMetadataBaseline({
        basePatch,
        captured: metadataOfAttributes(capturedAttributes),
      }),
    [basePatch, capturedAttributes],
  );
  const edits = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(drafts).map(([key, value]) => [traceAttributeKeyForMetadata(key), value]),
      ),
    [drafts],
  );

  const onEditAttribute = useCallback(
    ({ key, value }: { key: string; value: unknown }) => {
      const metadataKey = mapAttributeToTraceMetadataKey(key);
      if (metadataKey === null) return;
      setTraceMetadata({ key: metadataKey, value, baselineMetadata });
    },
    [setTraceMetadata, baselineMetadata],
  );

  const onResetAttribute = useCallback(
    (key: string) => {
      const metadataKey = mapAttributeToTraceMetadataKey(key);
      if (metadataKey === null) return;
      resetTraceMetadata(metadataKey);
    },
    [resetTraceMetadata],
  );

  const isKeyEditable = useCallback(
    (key: string) => mapAttributeToTraceMetadataKey(key) !== null,
    [],
  );

  const editing = useMemo(
    () => (enabled ? { edits, onEditAttribute, onResetAttribute, isKeyEditable } : undefined),
    [enabled, edits, onEditAttribute, onResetAttribute, isKeyEditable],
  );

  return { baselineAttributes, editing };
}
