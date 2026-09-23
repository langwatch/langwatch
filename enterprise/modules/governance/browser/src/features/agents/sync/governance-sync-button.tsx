import { Button } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { RefreshCw } from "lucide-react";

/**
 * The control asking a page's providers what they have; shape shared, words the caller's. It only
 * says what was STARTED, and `asked` disables it until reload because a second request is dropped.
 * @see specs/ai-governance/dashboard/governance-ui-controls.feature
 */
export type GovernanceSyncState =
  /** Pressable. */
  | "ready"
  /** The request is being recorded. Not: the provider is answering. */
  | "asking"
  /** A request was recorded this page session. */
  | "asked"
  /** There is nothing to ask, or nothing that can ask. */
  | "unavailable";

export function GovernanceSyncButton({
  label,
  state,
  reason,
  onPress,
}: {
  /** What this page calls the ask, e.g. "Sync agents". */
  label: string;
  state: GovernanceSyncState;
  /**
   * Why it cannot be pressed, in the page's own words. Required whenever the state is not
   * pressable: a disabled control with no reason is the defect this component exists to avoid, so
   * the two are one decision here rather than two props a call site can get half right.
   */
  reason: string | null;
  onPress: () => void;
}) {
  const disabled = state === "asked" || state === "unavailable";
  const button = (
    <Button
      size="sm"
      variant="ghost"
      loading={state === "asking"}
      disabled={disabled}
      onClick={onPress}
      data-testid="governance-sync-button"
      data-state={state}
      // The reason reaches a screen reader whether or not the tooltip is ever
      // opened. A disabled button stops firing pointer events in some
      // browsers, which is exactly when a hover-only explanation disappears.
      aria-label={reason ? `${label}. ${reason}` : label}
    >
      <RefreshCw size={14} />
      {label}
    </Button>
  );

  if (!reason) return button;
  return (
    <Tooltip content={reason}>
      {/* Wrapped, because a disabled button is not a hover target of its own. */}
      <span>{button}</span>
    </Tooltip>
  );
}
