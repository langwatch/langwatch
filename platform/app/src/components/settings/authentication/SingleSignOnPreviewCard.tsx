import { Button, Text } from "@chakra-ui/react";
import type { SsoConnectionLifecycleState } from "@langwatch/identity";
import { ArrowRight } from "lucide-react";
import { Link } from "~/components/ui/link";
import { connectionStatusChipFor } from "~/features/sso/logic/connectionStatus";
import { OverviewCard, OverviewDetail } from "./OverviewCard";

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
}: {
  /** Where a half-built connection got to, or null when there is none. */
  state?: SsoConnectionLifecycleState | null;
  /** `sso:manage`, and setting it up is available to this organization. */
  canManage?: boolean;
}) {
  // A connection that exists says where it stands in its own words; one that
  // does not says so plainly rather than borrowing a lifecycle state.
  const chip =
    state === null
      ? {
          label: "Not set up",
          tone: "neutral" as const,
          title: "No identity provider is connected to this organization.",
        }
      : connectionStatusChipFor({ state, routingSwitchedOn: false });

  return (
    <OverviewCard
      title="Single sign-on"
      chip={chip}
      data-testid="single-sign-on-preview-card"
      actions={
        canManage ? (
          <Link href="/settings/authentication/provider">
            <Button size="sm" variant="solid" colorPalette="orange">
              {state === null ? "Set it up" : "Carry on setting it up"}
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

      <OverviewDetail label={state === null ? "First step" : "Next step"}>
        <Text color="fg.muted">
          {state === null
            ? "Telling us about your identity provider."
            : "Carry on where you left off."}
        </Text>
      </OverviewDetail>
    </OverviewCard>
  );
}
