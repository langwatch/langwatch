import {
  Box,
  Button,
  type ButtonProps,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ComponentType, PropsWithChildren, ReactNode } from "react";

import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { CARD, SERIF } from "~/features/asaplangy/tokens";

/**
 * What a governance page shows when it has nothing to show.
 *
 * ONE SHAPE, MANY VOICES. The shape comes from the Langy empty state
 * (src/features/langy/components/EmptyState.tsx): a glyph, a serif headline, a
 * sentence of explanation, and something to press. That is what is shared.
 * Langy's words are Langy's alone — this component holds no copy of its own,
 * and every caller passes its page's own. A shared empty state that also
 * shared its sentences would put "Hey, I'm Langy!" on the inventory.
 *
 * It exists because the same requirement landed on the inventory and the
 * agents pages in one round, and two independently invented empty states is
 * how this codebase ended up with several separate sample badges. The agents
 * page's copy was written against this contract before the component existed
 * (src/components/governance/agents/emptyStates.ts) and drops straight in.
 *
 * WHAT IT REPLACES, and why the replacement is not just decoration: the
 * dashed box with a single grey sentence. That pattern fails a reader twice.
 * It looks like a component that failed to load rather than a page in a
 * legitimate state, and it leaves them exactly where they were, because a box
 * that only explains itself offers no way out.
 *
 * ON THE ACTION, which is where this component met the section's create-on-top
 * rule and briefly contradicted it. Create lives in the page header. An action
 * passed here is a SECOND DOORWAY TO THAT SAME DOOR, so it must carry the
 * header's own label and open the header's own flow. It is never a new create
 * control, and never a differently-worded one — that is the exact defect the
 * rule was written for. Under those terms it is welcome: a reader looking at
 * an empty pane is the reader most likely to want it, and both pages now pass
 * one. Inventory briefly named its header button in the sentence instead
 * ("Add one with Add tool, above"), which is worse than it looks: prose
 * naming a control goes stale the moment the control is renamed, and no rule
 * about controls can catch a sentence. Pass the control, do not describe it.
 * A pane whose reader cannot create passes nothing, and says so. See the
 * scenarios "A page offers
 * one create flow, under one label, from its header" and "An empty pane
 * explains itself rather than sitting blank" in
 * specs/ai-governance/dashboard/governance-ui-controls.feature.
 *
 * How heavily that action is drawn is a separate rule, and it moved: see
 * specs/ai-governance/dashboard/governance-summary-strip.feature and the note
 * on `GovernanceEmptyStateAction` below.
 */

/** Structural, so a lucide glyph and any other icon library both satisfy it. */
export type GovernanceEmptyStateIcon = ComponentType<{
  size?: string | number;
}>;

/**
 * The press at the end of an empty state.
 *
 * A component rather than a label prop because some of these actions cannot
 * own their own click: the inventory's is the trigger of a menu that picks a
 * source type, so the wrapper has to own the button. Passing the button itself
 * lets a menu, a dialog trigger or a plain handler all supply one without this
 * component knowing which.
 *
 * THE TWO WEIGHTS, AND WHY NEITHER IS SOLID ANY MORE. This used to draw
 * `primary` as a solid orange fill. The product owner rejected that treatment
 * across the whole governance section, so the loudest thing an empty pane may
 * offer is now the house button — `PageLayout.HeaderButton`, the small outline
 * button every page header already uses (see /settings/model-providers, which
 * pairs exactly this button in its header with the same outline treatment in
 * its empty state). It is imported rather than re-expressed here, so a change
 * to the house button reaches this pane too.
 *
 * The DISTINCTION the old solid carried is the part that had to survive, and
 * it does. `primary` is still for an action that creates something of the
 * organization's own; `secondary` is for one that only changes what is shown,
 * such as clearing a filter, and is drawn ghost — the same weight the section
 * gives its sample-data toggle at rest, for the same reason. Losing that
 * distinction is what left "Clear filters" and "Register agent" looking
 * identical the first time a page passed no emphasis at all.
 */
export function GovernanceEmptyStateAction({
  children,
  emphasis = "primary",
  ...props
}: PropsWithChildren<
  ButtonProps & {
    emphasis?: "primary" | "secondary";
  }
>) {
  if (emphasis === "primary") {
    return (
      <PageLayout.HeaderButton {...props}>{children}</PageLayout.HeaderButton>
    );
  }

  return (
    <Button size="sm" variant="ghost" {...props}>
      {children}
    </Button>
  );
}

export function GovernanceEmptyState({
  icon: Icon,
  headline,
  description,
  action,
  secondaryAction,
  testId,
}: {
  icon: GovernanceEmptyStateIcon;
  /** The state, not a fault. "No agents registered yet", not "No agents". */
  headline: string;
  /** One sentence saying why it is empty and what fills it. Two if the second earns itself. */
  description: string;
  /** The move that changes the state. Omit only when the reader has none. */
  action?: ReactNode;
  /** A second, quieter way out. At most one: three choices is a menu. */
  secondaryAction?: ReactNode;
  testId?: string;
}) {
  return (
    <VStack
      data-testid={testId}
      align="center"
      gap={0}
      width="full"
      // A hairline and a surface, never a dashed outline. Dashes read as a
      // drop target or a component that failed to arrive; this is neither.
      borderWidth={CARD.borderWidth}
      borderColor={CARD.border}
      borderRadius={CARD.radius}
      background={CARD.bg}
      paddingX={6}
      paddingY={10}
      textAlign="center"
    >
      {/* Neutral, not orange. The glyph is here to give the block a centre of
          gravity, not to be the loudest thing on a page that already has a
          primary action two lines below it. */}
      <Box
        color="fg.subtle"
        display="grid"
        placeItems="center"
        width="44px"
        height="44px"
        borderRadius="full"
        borderWidth="1px"
        borderColor="border.muted"
        background="bg.muted"
        marginBottom={4}
      >
        <Icon size={20} />
      </Box>
      <Text
        fontFamily={SERIF}
        fontSize="20px"
        fontWeight="500"
        letterSpacing="-0.02em"
        color="fg"
      >
        {headline}
      </Text>
      <Text
        textStyle="sm"
        color="fg.muted"
        lineHeight="1.5"
        textWrap="balance"
        // Wide enough for two lines of a real sentence, narrow enough that the
        // text stays a paragraph rather than spanning a widescreen table.
        maxWidth="420px"
        marginTop={2}
      >
        {description}
      </Text>
      {(action ?? secondaryAction) ? (
        <HStack gap={2} marginTop={5}>
          {action}
          {secondaryAction}
        </HStack>
      ) : null}
    </VStack>
  );
}
