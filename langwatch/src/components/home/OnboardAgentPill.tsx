import { Box, chakra, HStack, Text } from "@chakra-ui/react";
import { LuBot, LuSparkles, LuTerminal } from "react-icons/lu";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";

const INTEGRATION_DOCS = "https://docs.langwatch.ai/integration/overview";

/**
 * The prompt you hand to YOUR coding agent.
 *
 * This is the honest version of "onboard your agent": most people reading this
 * line are about to go and instrument a codebase, and the fastest way through
 * that is not a tab of documentation, it is a brief their own agent can act on.
 * It names the docs rather than reciting an API, because reciting one here is
 * how it silently goes stale the next time the SDK changes.
 */
const CODING_AGENT_PROMPT = `Instrument this codebase with LangWatch so I can see my agent's traces.

Read the integration guide at ${INTEGRATION_DOCS} and pick the SDK that matches this project. Then:
1. Add the dependency and initialise it where the app starts.
2. Read the API key from the environment, never hardcode it.
3. Instrument the main agent or LLM call path so a request produces one trace.
4. Tell me what you changed and how to verify a trace arrives.`;

/**
 * The route into agent onboarding: friendly copy, tool glyphs in their own
 * small tiles.
 *
 * Its own component because it has two homes and, more importantly, because
 * what it DOES changed. It used to be a link to the docs, which on a page
 * whose whole premise is "ask for what you want in plain language" was the one
 * control that shrugged and sent you to read. Now it offers the two ways
 * people actually onboard an agent: hand the job to Langy, or take a brief
 * away to the coding agent already open in their editor. The docs are still
 * there, third, for the reader who wanted them all along.
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
   * not one option among several — it is the only thing that makes the rest of
   * the page mean anything, so it stops being a quiet outline at the end of a
   * row and becomes the filled control the eye lands on.
   */
  prominent?: boolean;
} = {}) {
  // A toast, not an inline "Copied" label. The label lived inside a Menu.Item
  // and zag's menu closes on select, so the confirmation rendered into a menu
  // that was already gone — it was unreachable, and a copy that says nothing is
  // indistinguishable from one that failed. The toast also gives the rejection
  // path somewhere to go; it used to be swallowed.
  const copyPrompt = () => {
    void navigator.clipboard?.writeText(CODING_AGENT_PROMPT).then(
      () =>
        toaster.create({
          type: "success",
          title: "Prompt copied — paste it to your coding agent",
        }),
      () =>
        toaster.create({
          type: "error",
          title: "Couldn't copy the prompt",
        }),
    );
  };

  return (
    <Menu.Root positioning={{ placement: "bottom-middle", gutter: 6 }}>
      <Menu.Trigger asChild>
        <chakra.button
          type="button"
          display="inline-flex"
          alignItems="center"
          gap={2}
          whiteSpace="nowrap"
          borderWidth="1px"
          borderColor={prominent ? "orange.emphasized" : "border.muted"}
          borderRadius="full"
          background={prominent ? "orange.subtle" : "bg.surface"}
          paddingLeft={prominent ? 4 : 3}
          paddingRight="4px"
          paddingY={prominent ? "5px" : "3px"}
          boxShadow={prominent ? "xs" : undefined}
          cursor="pointer"
          transition="border-color 130ms ease, background 130ms ease"
          _hover={{
            borderColor: prominent ? "orange.solid" : "border.emphasized",
            background: prominent ? "orange.muted" : "bg.muted",
          }}
        >
          <chakra.span
            fontSize={prominent ? "13px" : "12px"}
            fontWeight={prominent ? "medium" : undefined}
            color={prominent ? "orange.fg" : "fg"}
          >
            {prominent ? "Send your first trace" : "Onboard your agent"}
          </chakra.span>
          <HStack gap="3px">
            {[
              { Glyph: LuBot, color: "fg.muted" },
              { Glyph: LuTerminal, color: "fg.muted" },
              { Glyph: LuSparkles, color: "orange.fg" },
            ].map(({ Glyph, color }, i) => (
              <Box
                key={i}
                boxSize="18px"
                borderRadius="5px"
                background="bg.muted"
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
        </chakra.button>
      </Menu.Trigger>
      <Menu.Content minWidth="280px" padding={1}>
        {onAskLangy ? (
          <Menu.Item
            value="ask-langy"
            paddingY={2}
            onClick={() =>
              onAskLangy(
                "Walk me through sending my first trace to this project. Ask me what my agent is built with, then give me the exact steps.",
              )
            }
          >
            <OnboardOption
              icon={LuSparkles}
              accent
              label="Walk me through it"
              hint="Langy asks what you are building, then gives you the steps"
            />
          </Menu.Item>
        ) : null}
        <Menu.Item value="copy-prompt" paddingY={2} onClick={copyPrompt}>
          <OnboardOption
            icon={LuTerminal}
            label="Copy a prompt for your coding agent"
            hint="Paste it into Claude Code, Cursor, or whatever you use"
          />
        </Menu.Item>
        <Menu.Item value="docs" paddingY={2} asChild>
          <chakra.a href={INTEGRATION_DOCS} target="_blank" rel="noreferrer">
            <OnboardOption
              icon={LuBot}
              label="Read the integration guide"
              hint="Every SDK, and what each one instruments"
            />
          </chakra.a>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

function OnboardOption({
  icon: Icon,
  label,
  hint,
  accent = false,
}: {
  icon: typeof LuBot;
  label: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <HStack gap={2.5} width="full" align="start">
      <Box
        color={accent ? "orange.fg" : "fg.subtle"}
        display="grid"
        paddingTop="2px"
      >
        <Icon size={13} />
      </Box>
      <Box minWidth={0} flex={1}>
        <Text textStyle="xs" fontWeight="medium">
          {label}
        </Text>
        <Text textStyle="2xs" color="fg.subtle" lineClamp={2}>
          {hint}
        </Text>
      </Box>
    </HStack>
  );
}
