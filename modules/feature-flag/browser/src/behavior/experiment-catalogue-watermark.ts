import { useCallback, useEffect, useState } from "react";

/**
 * Browser's record of newest experiment shown (presentation only; unread
 * dot indicator).
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
 * `catalogueVersions` comes from entries the backend actually returned,
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
