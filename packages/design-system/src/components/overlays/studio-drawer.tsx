/**
 * @deprecated Merged into `@langwatch/design-system/drawer` (ADR-002): every drawer now has the
 * inline error boundary, and the provider supplies `isDevelopment`. Import from `./drawer`;
 * this subpath goes in W-final.
 */
export type { AppDrawerSize, DrawerActionsProps, DrawerRootProps } from "./drawer.tsx";
export {
  Drawer,
  DrawerActions,
  DrawerCloseTrigger,
  DrawerContent,
  DrawerOffsetProvider,
  DrawerRoot,
} from "./drawer.tsx";
import { Drawer } from "./drawer.tsx";

/** @deprecated Import `Drawer` from `@langwatch/design-system/drawer`. */
export const DrawerTrigger = Drawer.Trigger;
/** @deprecated Import `Drawer` from `@langwatch/design-system/drawer`. */
export const DrawerFooter = Drawer.Footer;
/** @deprecated Import `Drawer` from `@langwatch/design-system/drawer`. */
export const DrawerHeader = Drawer.Header;
/** @deprecated Import `Drawer` from `@langwatch/design-system/drawer`. */
export const DrawerBody = Drawer.Body;
/** @deprecated Import `Drawer` from `@langwatch/design-system/drawer`. */
export const DrawerDescription = Drawer.Description;
/** @deprecated Import `Drawer` from `@langwatch/design-system/drawer`. */
export const DrawerTitle = Drawer.Title;
/** @deprecated Import `Drawer` from `@langwatch/design-system/drawer`. */
export const DrawerActionTrigger = Drawer.ActionTrigger;
