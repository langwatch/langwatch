/**
 * The Design System dialog, with the one behaviour the application's wrapper
 * adds and this family depends on.
 *
 * `platform/app/src/components/ui/dialog.tsx` is not a re-export: its
 * `DialogRoot` sets `trapFocus={false}` and `preventScroll={false}` on every
 * dialog in the product, and the impersonation dialog's `initialFocusEl` — the
 * reason an operator can type a reason without reaching for the mouse — only
 * lands on the input with the trap off. Importing the Design System's root
 * directly moved focus to the dialog container instead, which the
 * focus-on-open scenario caught.
 *
 * So the family takes the two props rather than the whole application
 * component. Everything else is the Design System's, unchanged.
 */

import { Dialog as DesignSystemDialog } from "@langwatch/design-system/dialog";
import type { ComponentProps } from "react";

type DialogRootProps = ComponentProps<typeof DesignSystemDialog.Root>;

function OpsDialogRoot(props: DialogRootProps) {
  return <DesignSystemDialog.Root {...props} trapFocus={false} preventScroll={false} />;
}

export const Dialog = { ...DesignSystemDialog, Root: OpsDialogRoot };
