/** Design System dialog with trapFocus and preventScroll props (impersonation dialog
 * needs unfocused input to type reason). */

import { Dialog as DesignSystemDialog } from "@langwatch/design-system/dialog";
import type { ComponentProps } from "react";

type DialogRootProps = ComponentProps<typeof DesignSystemDialog.Root>;

function OpsDialogRoot(props: DialogRootProps) {
  return <DesignSystemDialog.Root {...props} trapFocus={false} preventScroll={false} />;
}

export const Dialog = { ...DesignSystemDialog, Root: OpsDialogRoot };
