import { Box, chakra, HStack, Text } from "@chakra-ui/react";
import { LuBot, LuChevronDown, LuTerminal } from "react-icons/lu";
import { Menu } from "~/components/ui/menu";
import { copyCodingAgentBrief, INTEGRATION_DOCS } from "./codingAgentBrief";

/**
 * The route into agent onboarding, where onboarding is a utility rather than
 * the page's subject: the docs section's control (DocsGuides).
 *
 * It offers the two ways people onboard from a docs card: take a brief away
 * to the coding agent already open in their editor, or read the integration
 * guide. The hero used to carry this pill too — prominent, with a Langy
 * walkthrough item — but the hero's onboarding routes are language now (the
 * "Onboard my agent" ask and the quiet setup-brief line, see LangyHomeHero),
 * so the Langy route lives there and this control keeps only what the docs
 * card needs. The brief itself is shared with the hero's line
 * (codingAgentBrief.ts), so the two hand out the same thing.
 *
 * Spec: specs/home/langy-home.feature
 */
export function OnboardAgentPill() {
  return (
    <Menu.Root positioning={{ placement: "bottom-end", gutter: 6 }}>
      <Menu.Trigger asChild>
        <chakra.button
          type="button"
          /* It opens a menu — announce that, and show it (the caret below). */
          aria-haspopup="menu"
          display="inline-flex"
          alignItems="center"
          gap={2}
          whiteSpace="nowrap"
          borderWidth="1px"
          borderColor="border.emphasized"
          borderRadius="full"
          background="bg.muted"
          paddingLeft={3}
          paddingRight="4px"
          paddingY="3px"
          boxShadow="2xs"
          cursor="pointer"
          transition="border-color 130ms ease, background 130ms ease"
          _hover={{
            borderColor: "border.emphasized",
            background: "bg.emphasized",
          }}
        >
          <chakra.span fontSize="12px" color="fg">
            Onboard your agent
          </chakra.span>
          <HStack gap="3px">
            {[LuBot, LuTerminal].map((Glyph, i) => (
              <Box
                key={i}
                boxSize="18px"
                borderRadius="5px"
                /* The pill's own ground is a step darker, so the tiles take
                   the raised surface to stay legible against it. */
                background="bg.surface"
                borderWidth="1px"
                borderColor="border.muted"
                display="grid"
                placeItems="center"
                color="fg.muted"
              >
                <Glyph size={10} />
              </Box>
            ))}
          </HStack>
          {/* The caret is the interaction, stated: this control opens and
              asks you to choose a route, and a control should look like what
              it does before you touch it. */}
          <Box
            aria-hidden
            display="grid"
            color="fg.subtle"
            paddingRight="3px"
            flexShrink={0}
          >
            <LuChevronDown size={13} />
          </Box>
        </chakra.button>
      </Menu.Trigger>
      <Menu.Content minWidth="280px" padding={1}>
        <Menu.Item
          value="copy-brief"
          paddingY={2}
          onClick={copyCodingAgentBrief}
        >
          <OnboardOption
            icon={LuTerminal}
            label="Copy a setup brief for your coding agent"
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
}: {
  icon: typeof LuBot;
  label: string;
  hint: string;
}) {
  return (
    <HStack gap={2.5} width="full" align="start">
      <Box color="fg.subtle" display="grid" paddingTop="2px">
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
