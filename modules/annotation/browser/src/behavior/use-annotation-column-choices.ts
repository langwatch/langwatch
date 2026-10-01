import { useCallback, useState } from "react";
import { z } from "zod";

import type { AnnotationColumnChoices } from "../ui/elements/annotation-columns.ts";

const storageKey = (projectId: string) => `annotations:columns:${projectId}`;

const storedChoicesSchema = z.record(z.string(), z.unknown());

/** Anything that is not a plain on/off is dropped, so a bad entry never hides a column unseen. */
function readChoices(projectId: string): AnnotationColumnChoices {
  if (!projectId) return {};

  try {
    const stored = window.localStorage.getItem(storageKey(projectId));
    if (!stored) return {};

    const parsed = storedChoicesSchema.safeParse(JSON.parse(stored));
    if (!parsed.success) return {};

    return Object.fromEntries(
      Object.entries(parsed.data).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

/** The reviewer's column choices, kept per project in this browser only. */
export function useAnnotationColumnChoices({ projectId }: { projectId: string | undefined }) {
  const [choices, setChoices] = useState<AnnotationColumnChoices>(() =>
    readChoices(projectId ?? ""),
  );
  const [choicesFor, setChoicesFor] = useState(projectId);
  if (choicesFor !== projectId) {
    setChoicesFor(projectId);
    setChoices(readChoices(projectId ?? ""));
  }

  const persist = useCallback(
    (next: AnnotationColumnChoices) => {
      setChoices(next);
      if (!projectId) return;

      try {
        window.localStorage.setItem(storageKey(projectId), JSON.stringify(next));
      } catch {
        // A full or blocked store costs the reviewer their choice next visit, not this one.
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

  return { choices, setColumnVisible, resetColumns, hasChoices: Object.keys(choices).length > 0 };
}
