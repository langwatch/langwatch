import { Dialog } from "@langwatch/design-system/dialog";

import type { WorkflowCodeEditorModalHost } from "./workflow-code-editor.tsx";

/** The near-full-screen dialog an agent drawer opens its code editor in, above the drawer. */
export const CodeEditorModalHost: WorkflowCodeEditorModalHost = ({
  open,
  onRequestClose,
  children,
}) => (
  <Dialog.Root
    open={open}
    onOpenChange={({ open: nextOpen }) => !nextOpen && onRequestClose()}
    closeOnEscape={false}
  >
    <Dialog.Content
      margin="8"
      minWidth="calc(100vw - 64px)"
      height="calc(100vh - 64px)"
      display="flex"
      flexDirection="column"
      overflow="hidden"
      positionerProps={{ zIndex: 1502 }}
    >
      {children}
    </Dialog.Content>
  </Dialog.Root>
);
