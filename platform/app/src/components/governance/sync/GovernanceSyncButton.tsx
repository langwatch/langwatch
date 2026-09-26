import { Button } from "@chakra-ui/react";
import { RefreshCw } from "lucide-react";

import { Tooltip } from "~/components/ui/tooltip";

/**
 * The control that asks a governance page's providers to say what they have.
 *
 * ONE SHAPE, MANY VOICES, the same split the governance empty state makes: the
 * shape is shared and every word is the caller's. Agents and people are asked
 * of the same providers over the same pipeline, so the states are identical
 * and the sentences are not — "agents" and "people" are not interchangeable in
 * a sentence a reader is meant to act on.
 *
 * WHY IT NEVER REPORTS A RESULT. The request is dispatched and the call
 * returns; a pipeline calls the provider later and the outcome lands in the
 * log after that. There is no completion to await, so this button can only
 * ever say what was STARTED. A spinner that resolved into "found 4 agents"
 * would be inventing the half of the story that has not happened yet.
 *
 * WHY `asked` DISABLES IT UNTIL THE PAGE IS RELOADED. A second request while
 * one is in flight is dropped by the process manager, deliberately, not
 * queued. A button that stays live and silently does nothing is a button that
 * reads as broken, so once a request is recorded this one goes quiet and says
 * why. Reloading is how the reader sees the result, so "reload" is both the
 * honest instruction and the thing that brings the button back.
 *
 * Drawn ghost, so the one outlined control in a page header stays the action
 * that creates something of the organization's own — the arrangement the
 * people page's header already uses for `Run match pass`.
 * Rule: specs/ai-governance/dashboard/governance-ui-controls.feature
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
   * Why it cannot be pressed, in the page's own words. Required whenever the
   * state is not pressable: a disabled control with no reason is the defect
   * this component exists to avoid, so the two are one decision here rather
   * than two props a call site can get half right.
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
