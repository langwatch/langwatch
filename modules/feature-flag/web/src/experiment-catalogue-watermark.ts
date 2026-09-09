import { useCallback, useEffect, useState } from "react";

/**
 * A browser's record of the newest experiment it has already been shown.
 *
 * Purely a presentation receipt: it decides whether the Experiments entry
 * wears an unread dot, and nothing else. It is never an input to evaluation,
 * enrolment or authorization — the backend does not read it and would not
 * trust it if it did.
 *
 * Storage failure is not an error worth surfacing. The dialog stays usable
 * and the dot may keep reappearing, which is a far better outcome than a
 * broken menu.
 */
const STORAGE_KEY = "langwatch:experiments-seen-version";

function readWatermark(): number {
  if (typeof window === "undefined") return 0;

  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));

    return Number.isInteger(stored) && stored > 0 ? stored : 0;
  } catch {
    return 0;
  }
}

function writeWatermark(version: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(version));
  } catch {
    // Best effort. The dot may show again; nothing else depends on this.
  }
}

/**
 * The unread dot, and the acknowledgement that clears it.
 *
 * `catalogueVersions` comes from the entries the backend actually returned,
 * so an experiment the viewer cannot see can never light the dot.
 */
export function useExperimentCatalogueWatermark(catalogueVersions: readonly number[]): {
  hasUnseen: boolean;
  markSeen: () => void;
} {
  const [seenVersion, setSeenVersion] = useState(0);

  // Read after mount so the server-rendered markup and the first client
  // render agree; before that, nothing is unseen.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setSeenVersion(readWatermark());
    setMounted(true);
  }, []);

  const newestVersion = catalogueVersions.reduce((newest, version) => Math.max(newest, version), 0);

  const markSeen = useCallback(() => {
    if (newestVersion <= 0) return;

    writeWatermark(newestVersion);
    setSeenVersion(newestVersion);
  }, [newestVersion]);

  return { hasUnseen: mounted && newestVersion > seenVersion, markSeen };
}
