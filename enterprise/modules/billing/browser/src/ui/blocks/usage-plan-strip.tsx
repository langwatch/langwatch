/**
 * The plan on top of the usage page: its name, what it costs or includes, and the same action
 * the plan card carries on Plan & billing.
 * @see specs/licensing/usage-page.feature
 */
import { Link } from "@langwatch/browser-host/link";
import { Card } from "@langwatch/design-system/card";
import { Button } from "@langwatch/design-system/primitives";
import { StatusChip } from "@langwatch/design-system/settings-card";

import type { PlanStrip } from "../../model/usage-page-state.ts";

export function UsagePlanStrip({ strip, actionHref }: { strip: PlanStrip; actionHref: string }) {
  return (
    <Card
      data-testid="usage-plan-strip"
      title={strip.title}
      titleLevel={2}
      status="ok"
      badge={<StatusChip label="Current" tone="good" />}
      badgePlacement="title"
      description={<span data-testid="usage-plan-summary">{strip.summary}</span>}
      actions={
        strip.action === "upgrade" ? (
          <Button asChild size="sm" colorPalette="orange" data-emphasis="primary">
            <Link unstyled href={actionHref} data-testid="usage-upgrade-button">
              Upgrade to Growth
            </Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline">
            <Link unstyled href={actionHref} data-testid="usage-manage-button">
              Manage subscription
            </Link>
          </Button>
        )
      }
    />
  );
}
