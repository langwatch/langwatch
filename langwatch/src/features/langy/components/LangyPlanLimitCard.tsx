import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowUpRight, Crown } from "lucide-react";
import { LangyCard } from "~/features/asaplangy";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePlanManagementUrl } from "~/hooks/usePlanManagementUrl";
import { trackEvent } from "~/utils/tracking";
import { useRouter } from "~/utils/compat/next-router";
import { useLangyStore } from "../stores/langyStore";
import type { LangyToolErrorPresentation } from "../logic/langyToolFailure";

/**
 * A step that couldn't run because the plan ran out — and the way to change it.
 *
 * This REPLACES the generic failure card rather than sitting beside it. The
 * failure the user hit produced three tellings of one event (a red card, an
 * "unconfirmed" card, and a paragraph), and the red one was wrong anyway: it
 * read the 403 and said "Your access in this project doesn't cover this action",
 * sending them to check permissions when the truth was that their plan includes
 * three scenarios and all three were in use.
 *
 * A hybrid of three cards in the taxonomy, because it is doing all three jobs:
 * the RESULT card's material and its plain statement of fact (what the plan
 * includes, what is in use), the PROPOSAL's single primary action, and the ASK
 * card's "Needs you" eyebrow. `spotlight` is the intent it lands on — the full
 * panel material, the serif title, the generous padding — because the taxonomy
 * reserves that weight for what deserves the reader's whole attention, and a
 * turn that stopped because the plan ran out is the one card in a conversation
 * that qualifies.
 *
 * WHO gets the CTA is the point. Changing a plan is `organization:manage` — the
 * permission the subscription mutations themselves check
 * (`ee/billing/subscriptionRouter.ts`) — so anyone else is told plainly whom to
 * ask instead. Handing them a button into a page that will refuse them is a
 * dead end dressed up as a way forward.
 */
export function LangyPlanLimitCard({
  presentation,
}: {
  presentation: LangyToolErrorPresentation;
}) {
  const limit = presentation.limit!;
  const { project, hasOrgPermission } = useOrganizationTeamProject();
  const { url, buttonLabel } = usePlanManagementUrl();
  const router = useRouter();
  const panelMode = useLangyStore((state) => state.panelMode);
  const closePanel = useLangyStore((state) => state.closePanel);
  const canManagePlan = hasOrgPermission("organization:manage");

  const upgrade = () => {
    // Same funnel event every other upgrade prompt fires, so an upgrade that
    // started in Langy is not invisible next to one that started in a dialog.
    trackEvent("subscription_hook_click", {
      project_id: project?.id,
      hook: `${limit.type}_limit_reached`,
    });
    // A floating panel is a card OVER the page, and it lands squarely on the
    // upgrade button of the page this sends you to — an action that hides the
    // action it just promised. Get out of the way. The docked panel reserves
    // its own room and covers nothing, so it stays exactly where it is.
    if (panelMode === "floating") closePanel();
    void router.push(url);
  };

  return (
    <LangyCard
      intent="spotlight"
      role="alert"
      overline={
        <HStack gap={1.5} align="center">
          <Crown size={11} aria-hidden="true" />
          <Text as="span">Needs you</Text>
        </HStack>
      }
      title={`Your plan is out of ${limit.label}`}
      actions={
        canManagePlan ? (
          // The `ask` card's own CTA idiom — solid, in Langy's accent, the same
          // weight as the Apply on a proposal. It is the ONLY action on the
          // card and the only line beneath the fact, so nothing competes with
          // it: a second button and a "the step didn't go through" line both
          // sat here and both did nothing except pull the eye off it.
          <Button size="xs" colorPalette="orange" onClick={upgrade}>
            {buttonLabel}
            <ArrowUpRight size={12} aria-hidden="true" />
          </Button>
        ) : null
      }
    >
      <VStack align="stretch" gap={1.5}>
        <Text textStyle="xs" color="fg" lineHeight="1.45">
          {presentation.message}
        </Text>
        {canManagePlan ? null : (
          <Text textStyle="xs" color="fg.muted" lineHeight="1.45">
            {`Ask whoever manages your organization's plan to raise the ${limit.label} limit.`}
          </Text>
        )}
        {/* No failure code here, deliberately. Every other failure card shows
            one, because a code is the handle support needs on something that
            went wrong. Nothing went wrong: the plan says what it says, the card
            already explains it in full, and a diagnostic string under a pricing
            decision only makes it look like a bug. */}
      </VStack>
    </LangyCard>
  );
}
