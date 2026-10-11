/**
 * The published `drawer` subpath. Components live in `drawer-view.tsx` and nothing else, so an
 * edit there hot-swaps; the hooks, providers and Chakra namespace re-exported here would not.
 */
export * from "./drawer-view.tsx";
export { Drawer as RawDrawer } from "@chakra-ui/react";
export {
  DrawerOffsetProvider,
  setDrawerEndInset,
  useDrawerEndInset,
} from "../../overlays/drawer-inset.ts";
export { useOverlayPortalTarget } from "../../overlays/portal-target.ts";
export { DrawerGlassProvider } from "../../overlays/use-drawer-chrome.ts";
