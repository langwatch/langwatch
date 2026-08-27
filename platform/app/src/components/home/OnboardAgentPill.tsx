import { Box, chakra, HStack } from "@chakra-ui/react";
import type React from "react";
import { LuBot, LuChevronDown, LuSparkles, LuTerminal } from "react-icons/lu";
import { AgentActionsMenu, setupAgentPrompt } from "~/components/SetupWithAgentButton";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { selfHostedEndpoint } from "~/features/traces-v2/onboarding/logic/selfHostedEndpoint";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";

const INTEGRATION_DOCS = "https://docs.langwatch.ai/integration/overview";

const LANGY_WALKTHROUGH_PROMPT =
  "Walk me through sending my first trace to this project. Ask me what my agent is built with, then give me the exact steps.";

/**
 * The route into agent onboarding on the home page: friendly copy, tool
 * glyphs in their own small tiles.
 *
 * It offers the two ways people actually onboard an agent: take the tracing
 * skill away to the coding agent already open in their editor, or hand the
 * job to Langy. The docs are third, for the reader who wanted them all along.
 *
 * The menu itself is `AgentActionsMenu`, the same one every empty state
 * carries, so the routes stay in one order and the copied text stays the one
 * text. Only the trigger and the wording are this surface's own.
 *
 * `onAskLangy` is optional, and its absence is meaningful: on a page where
 * Langy is not available that item must not appear, rather than appear and
 * fail. Spec: specs/home/langy-home.feature
 */
export function OnboardAgentPill({
  onAskLangy,
  prominent = false,
}: {
  /** Start the onboarding conversation. Omitted where Langy is unavailable. */
  onAskLangy?: (prompt: string) => void;
  /**
   * Lead with it rather than tuck it away. For a project with no data, this is
   * not one option among several: it is the only thing that makes the rest of
   * the page mean anything, so it stops being a quiet outline at the end of a
   * row and becomes the filled control the eye lands on.
   */
  prominent?: boolean;
} = {}) {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const publicEnv = usePublicEnv();
  const canAsk = useCanAskLangy();
  // The same condition the menu itself applies, so the tiles on the pill
  // count the routes the menu actually opens with.
  const hasLangy = !!onAskLangy && canAsk;

  return (
    <AgentActionsMenu
      trigger={<OnboardPillTrigger prominent={prominent} hasLangy={hasLangy} />}
      langy={
        hasLangy && onAskLangy
          ? {
              prompt: LANGY_WALKTHROUGH_PROMPT,
              onAsk: onAskLangy,
              label: "Walk me through it",
              hint: "Langy asks what you are building, then gives you the steps",
            }
          : null
      }
      copy={{
        prompt: setupAgentPrompt("traces"),
        skill: "tracing",
        // The project's own key, so the agent gets a setup it can run rather
        // than one that stops to ask for credentials.
        apiKey: project?.apiKey,
        endpoint: selfHostedEndpoint(publicEnv.data?.BASE_HOST) ?? undefined,
        label: "Copy a prompt for your coding agent",
        hint: "Paste it into Claude Code, Cursor, or whatever you use",
        copiedTitle: "Prompt copied. Paste it to your coding agent",
      }}
      docs={{
        href: INTEGRATION_DOCS,
        icon: LuBot,
        label: "Read the integration guide",
        hint: "Every SDK, and what each one instruments",
      }}
    />
  );
}

/**
 * The pill itself. A different shade from the asks beside it on purpose, and
 * the tiles read left to right in the order the menu offers its routes.
 *
 * The menu opens it through `asChild`, which clones this element with the
 * handlers and the ref it needs, so everything but `prominent` goes straight
 * through to the button. Swallow them and the pill stops opening anything.
 */
/**
 * The two presentations, side by side.
 *
 * `lead` is the filled control a project with no data needs; `quiet` is the
 * outline one that sits at the end of a row once there is data. A DIFFERENT
 * SHADE from the asks around it in both cases: those are borrowable
 * questions on the panel's translucent chip surface, and this is the one
 * control that goes and does something. The solid raised surface, a step
 * darker than the chips, is what says "not one of those" before the caret
 * confirms it.
 */
const PILL_STYLES = {
  lead: {
    borderColor: "orange.emphasized",
    background: "orange.subtle",
    paddingLeft: 4,
    paddingY: "5px",
    boxShadow: "xs",
    label: "Send your first trace",
    fontSize: "13px",
    fontWeight: "medium",
    color: "orange.fg",
    _hover: { borderColor: "orange.solid", background: "orange.muted" },
  },
  quiet: {
    borderColor: "border.emphasized",
    background: "bg.muted",
    paddingLeft: 3,
    paddingY: "3px",
    boxShadow: "2xs",
    label: "Onboard your agent",
    fontSize: "12px",
    fontWeight: undefined,
    color: "fg",
    _hover: { borderColor: "border.emphasized", background: "bg.emphasized" },
  },
} as const;

function OnboardPillTrigger({
  prominent,
  hasLangy,
  ...menuProps
}: {
  prominent: boolean;
  /** Drops the Langy tile where the menu drops the Langy route. */
  hasLangy: boolean;
} & React.ComponentProps<typeof chakra.button>) {
  const style = prominent ? PILL_STYLES.lead : PILL_STYLES.quiet;
  return (
    <chakra.button
      type="button"
      /* It opens a menu, it does not fire a prompt like the asks beside
         it do. Announce that, and show it (the caret below). */
      aria-haspopup="menu"
      {...menuProps}
      display="inline-flex"
      alignItems="center"
      gap={2}
      whiteSpace="nowrap"
      borderWidth="1px"
      borderColor={style.borderColor}
      borderRadius="full"
      background={style.background}
      paddingLeft={style.paddingLeft}
      paddingRight="4px"
      paddingY={style.paddingY}
      boxShadow={style.boxShadow}
      cursor="pointer"
      transition="border-color 130ms ease, background 130ms ease"
      _hover={style._hover}
    >
      <chakra.span fontSize={style.fontSize} fontWeight={style.fontWeight} color={style.color}>
        {style.label}
      </chakra.span>
      <HStack gap="3px">
        {[
          { Glyph: LuTerminal, color: "fg.muted" },
          ...(hasLangy ? [{ Glyph: LuSparkles, color: "orange.fg" }] : []),
          { Glyph: LuBot, color: "fg.muted" },
        ].map(({ Glyph, color }, i) => (
          <Box
            key={i}
            boxSize="18px"
            borderRadius="5px"
            /* The pill's own ground went a step darker, so the tiles take
               the raised surface to stay legible against it. */
            background="bg.surface"
            borderWidth="1px"
            borderColor="border.muted"
            display="grid"
            placeItems="center"
            color={color}
          >
            <Glyph size={10} />
          </Box>
        ))}
      </HStack>
      {/* The caret is the interaction, stated. An ask fires the moment you
          click it; this one opens and asks you to choose a route, and a
          control should look like what it does before you touch it. */}
      <Box aria-hidden display="grid" color="fg.subtle" paddingRight="3px" flexShrink={0}>
        <LuChevronDown size={13} />
      </Box>
    </chakra.button>
  );
}
