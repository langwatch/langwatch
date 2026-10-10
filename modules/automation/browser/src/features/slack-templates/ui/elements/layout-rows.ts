import type { SlackDeliveryMethod } from "@langwatch/automation-contract";

import {
  type DraftCadence,
  type ReportTemplateSource,
  type SlackBlockKitTemplateId,
  type SlackBlockKitTemplateKind,
  type SlackBlockKitTemplateOption,
  templateOptionsFor,
} from "./registry.ts";

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
 * The layout list's rows: only the layouts built for the draft's own cadence. The receive
 * chooser is the one cadence control, so a pick in the list never changes the cadence.
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
