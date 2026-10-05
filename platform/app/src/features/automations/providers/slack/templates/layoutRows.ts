import type { SlackDeliveryMethod } from "@langwatch/automations/providers/slack";
import {
  type DraftCadence,
  type ReportTemplateSource,
  type SlackBlockKitTemplateId,
  type SlackBlockKitTemplateKind,
  type SlackBlockKitTemplateOption,
  templateOptionsFor,
} from "./registry";

/** Note shown on a layout a webhook connection can't render in full. */
export const GATED_NOTE = "Needs a Slack app connection";

export interface LayoutRow {
  option: SlackBlockKitTemplateOption;
  /** Shown, and previewable, but not applicable: the chosen connection can't
   *  render this layout in full. */
  isLocked: boolean;
  isDefault: boolean;
  isSelected: boolean;
}

/**
 * The rows the layout list renders: the layouts built for the draft's own
 * cadence, and nothing else. The receive chooser above the list is the one
 * cadence control — switching it re-filters the list, so a pick in the list
 * can never change the automation's cadence behind the author's back.
 */
export function buildLayoutRows({
  cadence,
  kind,
  reportSource,
  deliveryMethod,
  currentSource,
  defaultId,
}: {
  cadence: DraftCadence;
  kind: SlackBlockKitTemplateKind;
  reportSource?: ReportTemplateSource;
  deliveryMethod: SlackDeliveryMethod;
  currentSource: string;
  defaultId: SlackBlockKitTemplateId;
}): LayoutRow[] {
  return templateOptionsFor({ cadence, kind, reportSource }).map((option) => ({
    option,
    isLocked: deliveryMethod === "webhook" && !!option.gatedBlock,
    isDefault: option.id === defaultId,
    isSelected: option.source === currentSource,
  }));
}
