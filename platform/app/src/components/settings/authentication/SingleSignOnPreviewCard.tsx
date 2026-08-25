import { Text } from "@chakra-ui/react";
import { OverviewCard, OverviewDetail } from "./OverviewCard";

/**
 * What single sign-on would give this organization, on a page where nobody
 * can start setting it up yet.
 *
 * An administrator whose installation is unlicensed, or whose organization has
 * not been switched on, still opened Authentication to find out how their
 * people sign in. Answering them with nothing but a refusal makes a navigation
 * entry that leads to a wall: they learn neither what the feature is nor what
 * their organization does today. So the card stays, and says the true things —
 * what a connection does, how sign-in would be routed, and what the first step
 * is when it becomes available.
 *
 * NO CONTROL AND NO DATA. There is no button, because pressing one would be
 * refused, and a disabled button is still an invitation. There are no numbers,
 * because there is no connection to have any. The banner above the cards
 * carries the one thing that can actually be done next.
 */
export function SingleSignOnPreviewCard() {
  return (
    <OverviewCard
      title="Single sign-on"
      chip={{
        label: "Not set up",
        tone: "neutral",
        title: "No identity provider is connected to this organization.",
      }}
      data-testid="single-sign-on-preview-card"
    >
      <OverviewDetail label="What it does">
        <Text fontSize="sm">
          Your people sign in with your company&apos;s identity provider, and
          you decide there who still has access.
        </Text>
      </OverviewDetail>

      <OverviewDetail label="Who it applies to">
        <Text fontSize="sm">
          Anyone with an address at a domain you prove is yours is sent to your
          identity provider to sign in.
        </Text>
      </OverviewDetail>

      <OverviewDetail label="First step">
        <Text fontSize="sm" color="fg.muted">
          Telling us about your identity provider. Everything after it happens
          on this page.
        </Text>
      </OverviewDetail>
    </OverviewCard>
  );
}
