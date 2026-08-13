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
  /** Built for the cadence the list is not grouped around. Applying it also
   *  switches the automation's cadence. */
  fromOtherCadence: boolean;
  /** Shown, and previewable, but not applicable: the chosen connection can't
   *  render this layout in full. */
  locked: boolean;
  isDefault: boolean;
  isSelected: boolean;
}

export interface LayoutGroup {
  cadence: DraftCadence;
  /** Only trace automations split by cadence. An alert or a report sends one
   *  message either way, so their rows carry no heading. */
  heading?: string;
  rows: LayoutRow[];
}

export function otherCadenceOf(cadence: DraftCadence): DraftCadence {
  return cadence === "digest" ? "immediate" : "digest";
}

function headingFor({
  kind,
  cadence,
}: {
  kind: SlackBlockKitTemplateKind;
  cadence: DraftCadence;
}): string | undefined {
  if (kind !== "trace") return undefined;
  return cadence === "digest" ? "One digest message" : "One message per trace";
}

export function buildLayoutGroups({
  groupingCadence,
  kind,
  reportSource,
  deliveryMethod,
  currentSource,
  defaultId,
}: {
  groupingCadence: DraftCadence;
  kind: SlackBlockKitTemplateKind;
  reportSource?: ReportTemplateSource;
  deliveryMethod: SlackDeliveryMethod;
  currentSource: string;
  defaultId: SlackBlockKitTemplateId;
}): LayoutGroup[] {
  const toRow = ({
    option,
    fromOtherCadence,
  }: {
    option: SlackBlockKitTemplateOption;
    fromOtherCadence: boolean;
  }): LayoutRow => ({
    option,
    fromOtherCadence,
    locked: deliveryMethod === "webhook" && !!option.gatedBlock,
    isDefault: !fromOtherCadence && option.id === defaultId,
    isSelected: option.source === currentSource,
  });
  const primary: LayoutGroup = {
    cadence: groupingCadence,
    heading: headingFor({ kind, cadence: groupingCadence }),
    rows: templateOptionsFor({
      cadence: groupingCadence,
      kind,
      reportSource,
    }).map((option) => toRow({ option, fromOtherCadence: false })),
  };
  // Alerts always fire the moment the metric crosses, so there is no second
  // cadence to offer alongside.
  if (kind === "graphAlert") return [primary];
  const other = otherCadenceOf(groupingCadence);
  const otherRows = templateOptionsFor({ cadence: other, kind, reportSource })
    .filter((opt) => opt.cadenceFit !== "both")
    .map((option) => toRow({ option, fromOtherCadence: true }));
  if (otherRows.length === 0) return [primary];
  return [
    primary,
    {
      cadence: other,
      heading: headingFor({ kind, cadence: other }),
      rows: otherRows,
    },
  ];
}
