/**
 * The published `drawer` subpath. Only components live in `views/drawer-view.tsx`, so an
 * edit there hot-swaps; the hooks, providers and Chakra namespace re-exported here would not.
 */
export * from "./views/drawer-view.tsx";
export { Drawer as RawDrawer } from "@chakra-ui/react";
export { useReserveDrawerFocus } from "../../overlays/drawer-focus.ts";
export {
  DrawerOffsetProvider,
  setDrawerEndInset,
  useDrawerEndInset,
} from "../../overlays/drawer-inset.ts";
export { useOverlayPortalTarget } from "../../overlays/portal-target.ts";
export { DrawerGlassProvider } from "../../overlays/use-drawer-chrome.ts";
