/**
 * "Action needed for updates" on Home, for whoever holds ops:view, while an operator step of the
 * running version is unfinished. Draws nothing otherwise, nor while loading or on a failed read.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { Link } from "@langwatch/browser-host/link";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { ArrowRight } from "lucide-react";

import { useOpsPermission } from "../../../../behavior/ops-session.ts";
import { useUnfinishedOperatorSteps } from "../../behavior/use-unfinished-operator-steps.ts";

export function UpgradeActionNeeded() {
  const { hasAccess } = useOpsPermission();
  const steps = useUnfinishedOperatorSteps({ enabled: hasAccess });

  if (!hasAccess || steps.length === 0) return null;

  return (
    <Banner
      status="warning"
      title="Action needed for updates"
      data-testid="home-upgrade-action-needed"
      action={
        <BannerAction asChild>
          <Link href="/ops/upgrades">
            Open Upgrades
            <ArrowRight size={12} aria-hidden />
          </Link>
        </BannerAction>
      }
    >
      {steps.length === 1
        ? "One operator step of this version is not finished."
        : `${steps.length} operator steps of this version are not finished.`}
    </Banner>
  );
}
