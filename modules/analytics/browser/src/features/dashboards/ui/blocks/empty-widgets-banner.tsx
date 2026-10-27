/**
 * Above a board where several widgets show no data: how many, and "Ask Langy to set this up",
 * which drafts the step for the reader to send (dashboards-v2.feature AC13d).
 */

import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Sparkles } from "lucide-react";

import { offersBoardSetup } from "../../langy/model/board-langy.ts";

export function EmptyWidgetsBanner({
  emptyWidgetNames,
  onAskLangy,
}: {
  emptyWidgetNames: readonly string[];
  /** Drafts the setup in Langy; absent when Langy is not available, and so is the banner. */
  onAskLangy?: () => void;
}) {
  if (!onAskLangy || !offersBoardSetup(emptyWidgetNames)) return null;
  return (
    <Banner
      status="info"
      icon={<Sparkles size={16} />}
      title={`${emptyWidgetNames.length} widgets on this dashboard have no data yet`}
      action={<BannerAction onClick={onAskLangy}>Ask Langy to set this up</BannerAction>}
      data-testid="empty-widgets-banner"
    >
      Langy can check what each one needs and help you send it.
    </Banner>
  );
}
