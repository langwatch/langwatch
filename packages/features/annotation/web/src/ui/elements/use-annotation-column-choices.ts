import { useCallback, useEffect, useState } from "react";
import type { AnnotationColumnChoices } from "./annotation-columns";

/**
 * The reviewer's column choices, kept per project so a wide review project and
 * a narrow one do not fight over one layout. Local to the browser on purpose:
 * this is how one person likes to read the list, not something the project
 * agrees on, and nothing is lost if it does not follow them to another machine.
 */
const storageKey = (projectId: string) => `annotations:columns:${projectId}`;

const readChoices = (projectId: string): AnnotationColumnChoices => {
  if (typeof window === "undefined" || !projectId) return {};
  try {
    const stored = window.localStorage.getItem(storageKey(projectId));
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Anything that is not a plain on/off is not a choice this build wrote, so
    // it is dropped rather than trusted: a bad entry would otherwise hide a
    // column with no way to work out why.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
};

export function useAnnotationColumnChoices({ projectId }: { projectId: string | undefined }) {
  const [choices, setChoices] = useState<AnnotationColumnChoices>({});

  // Read after mount rather than in the initial state, so the server and the
  // first client render agree and the table does not flash a different set.
  useEffect(() => {
    setChoices(readChoices(projectId ?? ""));
  }, [projectId]);

  const persist = useCallback(
    (next: AnnotationColumnChoices) => {
      setChoices(next);
      if (typeof window === "undefined" || !projectId) return;
      try {
        window.localStorage.setItem(storageKey(projectId), JSON.stringify(next));
      } catch {
        // A full or blocked store costs the reviewer their choice next visit,
        // never this one: the table already has it in state.
      }
    },
    [projectId],
  );

  const setColumnVisible = useCallback(
    ({ columnId, isVisible }: { columnId: string; isVisible: boolean }) =>
      persist({ ...choices, [columnId]: isVisible }),
    [choices, persist],
  );

  const resetColumns = useCallback(() => persist({}), [persist]);

  return {
    choices,
    setColumnVisible,
    resetColumns,
    hasChoices: Object.keys(choices).length > 0,
  };
}
