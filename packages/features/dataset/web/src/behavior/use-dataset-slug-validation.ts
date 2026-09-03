/**
 * The slug a dataset name would get, and whether another dataset already holds it.
 *
 * A family-local copy of `platform/app/src/components/datasets/useDatasetSlugValidation`,
 * which the upload confirm drawer still calls. Deletes-only forbids repointing
 * it, so the platform copy stays for that flow and this one travels with the
 * add-or-edit drawer.
 *
 * ONE SUBSTITUTION, deliberate: the platform hook debounced through
 * `use-debounce`, which this package does not depend on and which a page move is
 * not the place to add. The scheduling below states the same three rules that
 * hook configured — check on the FIRST keystroke of a run so a fresh name shows
 * its slug immediately, again once typing settles for 500ms, and never leave
 * more than 1000ms between checks while typing continues — and it cancels on
 * unmount, so a settled check never lands in a torn-down form.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SlugValidation } from "../model/dataset-slug-validation";
import { datasetApi } from "./dataset-api";

/** How long typing has to settle before the trailing check runs. */
const SETTLE_MS = 500;
/** The longest a run of continuous typing may go unchecked. */
const MAX_WAIT_MS = 1_000;

export function useDatasetSlugValidation({
  projectId,
  name,
  datasetId,
}: {
  projectId: string | undefined;
  name: string;
  datasetId?: string;
}) {
  const [slugInfo, setSlugInfo] = useState<SlugValidation>(null);

  /** The stored slug, so an edit can show "old -> new" rather than just "new". */
  const existing = datasetApi.dataset.getById.useQuery(
    { projectId: projectId ?? "", datasetId: datasetId ?? "" },
    { enabled: !!datasetId && !!projectId },
  );
  const dbSlug = existing.data?.slug;

  const check = datasetApi.dataset.validateDatasetName.useQuery(
    { projectId: projectId ?? "", proposedName: name, excludeDatasetId: datasetId },
    // Asked by hand on the schedule below, never on render.
    { enabled: false },
  );

  const refetchRef = useRef(check.refetch);
  refetchRef.current = check.refetch;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the last check went out, so the leading edge and the cap can be read off it. */
  const lastCheckAt = useRef(0);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const run = useCallback(() => {
    cancel();
    lastCheckAt.current = Date.now();
    void refetchRef.current().then((result) => {
      if (!result.data) return;
      setSlugInfo({
        slug: result.data.slug,
        hasConflict: !result.data.available,
        conflictsWith: result.data.conflictsWith,
      });
    });
  }, [cancel]);

  useEffect(() => {
    if (!projectId || name.trim() === "") {
      setSlugInfo(null);
      cancel();
      lastCheckAt.current = 0;
      return;
    }

    const sinceLastCheck = Date.now() - lastCheckAt.current;
    // The first change after a quiet period is checked at once, so a name typed
    // into an empty field shows its slug without a pause.
    if (sinceLastCheck >= MAX_WAIT_MS) {
      run();
      return;
    }

    // Otherwise wait for typing to settle — but never past the cap, so a long
    // run of keystrokes still reports a conflict while it is being typed.
    cancel();
    timer.current = setTimeout(run, Math.min(SETTLE_MS, MAX_WAIT_MS - sinceLastCheck));
    return cancel;
  }, [name, projectId, run, cancel]);

  useEffect(() => cancel, [cancel]);

  const displaySlug = datasetId
    ? dbSlug && slugInfo?.slug === undefined
      ? dbSlug
      : slugInfo?.slug
    : slugInfo?.slug;

  const slugWillChange = !!datasetId && !!dbSlug && !!slugInfo?.slug && dbSlug !== slugInfo.slug;

  return {
    slugInfo,
    displaySlug,
    slugWillChange,
    dbSlug,
    resetSlugInfo: useCallback(() => setSlugInfo(null), []),
  };
}
