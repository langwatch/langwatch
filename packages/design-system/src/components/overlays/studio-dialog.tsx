/**
 * @deprecated Merged into `@langwatch/design-system/dialog` (ADR-002): focus is trapped, fields
 * stack, the error boundary wraps every dialog and the provider supplies `isDevelopment`.
 * Import from `./dialog`; this subpath goes in W-final.
 */
export {
  Dialog,
  DialogActionTrigger,
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "./dialog.tsx";
export type { DialogContentProps, DialogRootProps } from "./dialog.tsx";
