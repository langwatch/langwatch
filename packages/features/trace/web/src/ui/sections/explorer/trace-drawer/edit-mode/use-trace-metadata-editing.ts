import { useCallback, useMemo } from "react";
import {
  traceAttributeKeyForMetadata,
  traceMetadataKeyForAttribute,
} from "@langwatch/trace-contract";
import { selectTraceMetadataBaseline, useTraceEditStore } from "../../../../../index";
import type { AttributeEditing } from "../attribute-table";

/**
 * Connects the summary's metadata table to the draft.
 *
 * The table shows the attribute rows the trace was ingested with, while a
 * correction is written in the bare keys the canonical trace metadata uses, so
 * the two spellings are translated here and nowhere else. Rows the correction
 * may not touch carry no editor: the platform's own namespace, and the keys a
 * conversation, a user, a customer or a scenario run is grouped by.
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

  const baselineAttributes = useMemo(() => {
    const stored = basePatch?.trace?.metadata;
    if (stored === undefined) return capturedAttributes;
    if (stored === null) return {};

    const next = { ...capturedAttributes };
    for (const [key, value] of Object.entries(stored)) {
      const attributeKey = traceAttributeKeyForMetadata(key);
      if (value === null) delete next[attributeKey];
      else next[attributeKey] = value;
    }
    return next;
  }, [basePatch, capturedAttributes]);

  const baselineMetadata = useMemo(() => {
    const captured: Record<string, unknown> = {};
    for (const [attributeKey, value] of Object.entries(capturedAttributes)) {
      const key = traceMetadataKeyForAttribute(attributeKey);
      if (key !== null) captured[key] = value;
    }
    return selectTraceMetadataBaseline({ basePatch, captured });
  }, [basePatch, capturedAttributes]);

  const edits = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(drafts)) {
      out[traceAttributeKeyForMetadata(key)] = value;
    }
    return out;
  }, [drafts]);

  const onEditAttribute = useCallback(
    ({ key, value }: { key: string; value: unknown }) => {
      const metadataKey = traceMetadataKeyForAttribute(key);
      if (metadataKey === null) return;
      setTraceMetadata({ key: metadataKey, value, baselineMetadata });
    },
    [setTraceMetadata, baselineMetadata],
  );

  const onResetAttribute = useCallback(
    (key: string) => {
      const metadataKey = traceMetadataKeyForAttribute(key);
      if (metadataKey === null) return;
      resetTraceMetadata(metadataKey);
    },
    [resetTraceMetadata],
  );

  const isKeyEditable = useCallback(
    (key: string) => traceMetadataKeyForAttribute(key) !== null,
    [],
  );

  const editing = useMemo(
    () => (enabled ? { edits, onEditAttribute, onResetAttribute, isKeyEditable } : undefined),
    [enabled, edits, onEditAttribute, onResetAttribute, isKeyEditable],
  );

  return { baselineAttributes, editing };
}
