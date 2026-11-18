/**
 * Braids paused below Enterprise: kept, and what brings them back. Upgrading alone resumes them
 * only when the organisation's Braids setting is known to be on.
 * Spec: modules/authz/specs/braids-screen.feature, "After leaving Enterprise ...".
 */

import { Link } from "@langwatch/browser-host/link";
import { Banner, BannerAction } from "@langwatch/design-system/banner";

export function BraidsPlanPausedBanner({
  kept,
  isSingleBraid,
  turnedOn,
}: {
  /** The subject of the sentence, such as "Your 2 braids are". */
  kept: string;
  /** The subject is one braid, so the verb agrees with it. */
  isSingleBraid: boolean;
  /** The organisation's Braids setting: undefined while it is unread. */
  turnedOn: boolean | undefined;
}) {
  const starts = isSingleBraid ? "starts" : "start";
  let resume = `${starts} working again when you upgrade.`;
  if (turnedOn === false) {
    resume = `${starts} working again once you upgrade and an organisation admin turns Braids on.`;
  } else if (turnedOn === undefined) {
    resume = `${starts} working again once you upgrade, if Braids is on for your organisation.`;
  }
  return (
    <Banner
      status="warning"
      title="Braids are paused"
      data-testid="braids-plan-paused"
      action={
        <BannerAction asChild>
          <Link href="/settings/plans">See plans</Link>
        </BannerAction>
      }
    >
      Braids need the Enterprise plan. {kept} kept and {resume}
    </Banner>
  );
}
