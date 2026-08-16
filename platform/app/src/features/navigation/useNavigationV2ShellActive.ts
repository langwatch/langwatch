import { useRouter } from "~/utils/compat/next-router";
import { productFromPathname } from "./products";
import { useNavigationMode } from "./useNavigationMode";

/**
 * Whether the current page renders inside a navigation-v2 product shell:
 * the device resolved to a new mode AND the route belongs to a product
 * (settings and internal ops pages keep the legacy chrome until their
 * own shells land). Inner layouts use this to stand their duplicate
 * navigation down; it stays false while the mode is still resolving, so
 * a legacy render never loses its rail to a flash.
 */
export function useNavigationV2ShellActive(): boolean {
  const resolution = useNavigationMode();
  const router = useRouter();
  return (
    resolution.status === "ready" &&
    resolution.mode !== "legacy" &&
    productFromPathname(router.pathname) !== null
  );
}
