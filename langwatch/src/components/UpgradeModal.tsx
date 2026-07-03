import { lazy, Suspense } from "react";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";

/**
 * The heavy modal body (dialog UI plus the tRPC-driven limit / seats /
 * lite-member content) lives in its own chunk in `UpgradeModalContent`
 * and is fetched only when a modal is actually opened — i.e. when the
 * store's `variant` becomes non-null. This defers the modal's own code
 * (~6 kB raw / ~2.4 kB gzip, measured) off the initial load. The shared
 * UI chunk it depends on stays eager (used app-wide), so this is a small
 * structural win, not a fix for the Lighthouse bundle finding.
 */
const LazyUpgradeModal = lazy(() =>
  import("./UpgradeModalContent").then((m) => ({ default: m.UpgradeModal })),
);

/**
 * Store-driven mount for the upgrade/limit dialog. Every full-screen
 * surface must render this once: limit-exceeded mutations open the
 * dialog through `useUpgradeModalStore`, and a surface without this
 * mount swallows the error into a silent no-op (the studio bug - the
 * dialog only "appeared" after navigating back to a dashboard page).
 */
export function GlobalUpgradeModal() {
  const { isOpen, variant, close } = useUpgradeModalStore();
  if (!variant) return null;
  return (
    <Suspense fallback={null}>
      <LazyUpgradeModal open={isOpen} onClose={close} variant={variant} />
    </Suspense>
  );
}
