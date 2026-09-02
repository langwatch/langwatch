/**
 * What the advanced-features gate dialog is showing, as a value.
 *
 * It lives in `model` rather than beside the hook that produces it because
 * `ui/blocks` renders it and a block may not depend upward on `behavior` — the
 * layer direction ADR-004 states, and the reason the type and the hook are two
 * modules. A dialog state is a portable value in any case.
 */

export type PersonalFeatureGateDialogState = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isEnabling: boolean;
};
