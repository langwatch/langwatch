import { Dialog as ChakraDialog } from "@chakra-ui/react";

/**
 * The published `dialog` subpath. Only components live in `views/dialog-view.tsx`, so an
 * edit there hot-swaps; the Chakra part aliases and hooks re-exported here would not.
 */
export * from "./views/dialog-view.tsx";
export { Dialog as RawDialog } from "@chakra-ui/react";
export { useOverlayPortalTarget } from "../../overlays/portal-target.ts";

/** @deprecated Use the shape's actions. */
export const DialogFooter = ChakraDialog.Footer;
/** @deprecated Use the shape's `title`, `icon`, `onBack`. */
export const DialogHeader = ChakraDialog.Header;
/** @deprecated The shape's children are its body. */
export const DialogBody = ChakraDialog.Body;
/** @deprecated Use the shape's `title`. */
export const DialogTitle = ChakraDialog.Title;
/** @deprecated Use the shape's `description`. */
export const DialogDescription = ChakraDialog.Description;
/** @deprecated Open a dialog from state: `open` and `onClose`. */
export const DialogTrigger = ChakraDialog.Trigger;
/** @deprecated The shape draws Cancel. */
export const DialogActionTrigger = ChakraDialog.ActionTrigger;
