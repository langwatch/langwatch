import { Button, Text } from "@chakra-ui/react";
import { connectionStatusChipFor } from "@ee/sso/logic/connectionStatus";
import type {
  SsoConnectionLifecycleState,
  SsoMigrationPhase,
} from "@langwatch/identity";
import { ArrowRight } from "lucide-react";
import {
  OverviewCard,
  OverviewDetail,
} from "~/components/settings/authentication/OverviewCard";
import { Link } from "~/components/ui/link";
import { singleSignOnUpdateChipFor } from "../singleSignOn/migration-progress";

/**
 * What single sign-on would give this organization, before there is one to
 * read.
 *
 * TWO READERS, ONE CARD. An administrator whose installation is unlicensed, or
 * whose organization has not been switched on, still opened Authentication to
 * find out how their people sign in — answering them with nothing but a
 * refusal makes a navigation entry that leads to a wall. And an administrator
 * three steps into the journey needs the overview to say where they got to
 * rather than pretending nothing exists. Both get the same card: what a
 * connection does, who it applies to, and what happens next.
 *
 * THE ACTION IS THE JOURNEY, and it is only offered to somebody who would not
 * be refused it. A disabled button is still an invitation, and inviting
 * somebody to do a thing they cannot is worse than not offering it.
 */
export function SingleSignOnPreviewCard({
  state = null,
  canManage = false,
  goLiveBlockedBecause,
  updatePhase = null,
}: {
  /** Where a half-built connection got to, or null when there is none. */
  state?: SsoConnectionLifecycleState | null;
  /** `sso:manage`, and setting it up is available to this organization. */
  canManage?: boolean;
  /**
   * Why turning it on is not available yet, so a proved domain is not
   * announced as ready while the journey still has steps in it.
   */
  goLiveBlockedBecause?: string | null;
  /**
   * Where an update to the organization's own identity provider got to, when
   * one is under way.
   */
  updatePhase?: SsoMigrationPhase | null;
}) {
  // An update in flight OUTRANKS the lifecycle state. The connection this card
  // is describing is a replacement for one that is signing the whole company
  // in, so "still setting up" is true of the row and useless to the reader:
  // what they need is which step of the update they are on, in the words the
  // single sign-on page uses for the same state.
  //
  // A connection that exists otherwise says where it stands in its own words;
  // one that does not says so plainly rather than borrowing a lifecycle state.
  const chip = updatePhase
    ? singleSignOnUpdateChipFor(updatePhase)
    : state === null
      ? {
          label: "Not set up",
          tone: "neutral" as const,
          title: "No identity provider is connected to this organization.",
        }
      : connectionStatusChipFor({ state, goLiveBlockedBecause });

  return (
    <OverviewCard
      title="Single sign-on"
      chip={chip}
      data-testid="single-sign-on-preview-card"
      actions={
        canManage ? (
          <Link
            href="/settings/authentication/provider"
            data-testid="single-sign-on-preview-action"
          >
            <Button size="sm" variant="solid" colorPalette="orange">
              {updatePhase
                ? "Where it stands"
                : state === null
                  ? "Set it up"
                  : "Carry on setting it up"}
              <ArrowRight size={14} />
            </Button>
          </Link>
        ) : undefined
      }
    >
      <OverviewDetail label="What it does">
        <Text>
          Your people sign in with your company&apos;s identity provider, and
          you decide there who still has access.
        </Text>
      </OverviewDetail>

      <OverviewDetail label="Who it applies to">
        <Text>Anyone with an address at a domain you prove is yours.</Text>
      </OverviewDetail>

      <OverviewDetail
        label={updatePhase || state !== null ? "Next step" : "First step"}
      >
        <Text color="fg.muted">
          {updatePhase
            ? chip.title
            : state === null
              ? "Telling us about your identity provider."
              : "Carry on where you left off."}
        </Text>
      </OverviewDetail>
    </OverviewCard>
  );
}
