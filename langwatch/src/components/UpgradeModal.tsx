import { lazy, Suspense } from "react";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";

/**
 * The heavy modal body (dialog UI plus the tRPC-driven limit / seats /
 * lite-member content) lives in its own chunk in `UpgradeModalContent`.
 * It is only fetched when a modal is actually opened — i.e. when the
 * store's `variant` becomes non-null — so ~130 KiB stays off the critical
 * first-load path for the (almost all) users who never hit a plan limit
 * during a session.
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
