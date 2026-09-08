import { useEffect, useRef, useState } from "react";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";

/**
 * Click-to-edit state for a query's `LW.query` handle name: the draft, the
 * input ref it focuses on entry, and commit/cancel. Commit only fires an
 * `onChange` when the name actually changed, so a click that edits nothing
 * can't churn the query list.
 */
export function useEditableQueryName({
  query,
  onChange,
}: {
  query: DashboardWidgetQuery;
  onChange: (next: DashboardWidgetQuery) => void;
}) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(query.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingName]);

  const startEditing = () => {
    setDraftName(query.name);
    setIsEditingName(true);
  };

  const commit = () => {
    if (draftName !== query.name) onChange({ ...query, name: draftName });
    setIsEditingName(false);
  };

  const cancel = () => setIsEditingName(false);

  return {
    isEditingName,
    draftName,
    setDraftName,
    inputRef,
    startEditing,
    commit,
    cancel,
  };
}

export type EditableQueryName = ReturnType<typeof useEditableQueryName>;
