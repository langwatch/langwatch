/**
 * PersonalTracesEmptyState — the /me "Recent activity" empty state.
 *
 * Reuses the project traces page's IntegratePaneShell (the centred
 * orange glow + hero) so the two no-data states share a visual
 * language, but pitches the tools a personal user already has on /me — a
 * coding assistant, an ingestion key, an API key — instead of the
 * generic agent / MCP / SDK integration guide the project pane shows.
 * Personal users send traces through their tiles, not by hand-wiring an
 * SDK, so the two in-page offers scroll up to the matching section and
 * the third deep-links to the project's API-keys settings.
 */
import { Box, chakra, Icon, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { Bot, KeyRound, Webhook } from "lucide-react";
import type React from "react";
import { Link } from "~/components/ui/link";
import { IntegratePaneShell } from "~/features/traces-v2/components/TracesPage/IntegratePaneShell";

/** Anchor ids the offers scroll to — set on the matching /me sections. */
export const PERSONAL_AI_TOOLS_ANCHOR = "me-ai-tools";
export const PERSONAL_TRACE_INGEST_ANCHOR = "me-trace-ingest";

function scrollToId(id: string) {
  if (typeof document === "undefined") return;
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const cardProps = {
  appearance: "none" as const,
  font: "inherit",
  borderWidth: "1px",
  borderColor: "border.muted",
  borderRadius: "lg",
  padding: 4,
  bg: "bg.panel",
  width: "full",
  height: "full",
  textAlign: "left" as const,
  cursor: "pointer",
  transition: "all 0.15s ease",
  _hover: {
    borderColor: "orange.emphasized",
    bg: "orange.subtle",
    transform: "translateY(-1px)",
  },
  _active: { transform: "translateY(0)" },
};

type Offer = {
  icon: React.ElementType;
  title: string;
  description: string;
} & (
  | { onClick: () => void; href?: undefined }
  | { href: string; onClick?: undefined }
);

function OfferBody({
  icon,
  title,
  description,
}: Pick<Offer, "icon" | "title" | "description">) {
  return (
    <VStack align="start" gap={2}>
      <Icon as={icon} boxSize={5} color="orange.solid" />
      <Text fontWeight="600" fontSize="sm" color="fg">
        {title}
      </Text>
      <Text fontSize="xs" color="fg.muted" lineHeight="tall">
        {description}
      </Text>
    </VStack>
  );
}

const OfferCard: React.FC<Offer> = ({ icon, title, description, onClick, href }) => {
  if (href) {
    return (
      <Link href={href} display="block" _hover={{ textDecoration: "none" }}>
        <Box {...cardProps}>
          <OfferBody icon={icon} title={title} description={description} />
        </Box>
      </Link>
    );
  }
  return (
    <chakra.button type="button" onClick={onClick} {...cardProps}>
      <OfferBody icon={icon} title={title} description={description} />
    </chakra.button>
  );
};

export function PersonalTracesEmptyState({
  projectSlug,
}: {
  projectSlug?: string | null;
}) {
  const offers: Offer[] = [
    {
      icon: Bot,
      title: "Set up a coding assistant",
      description:
        "Wire up Claude Code, Codex, Gemini or opencode in one command and your sessions land here.",
      onClick: () => scrollToId(PERSONAL_AI_TOOLS_ANCHOR),
    },
    {
      icon: Webhook,
      title: "Mint an ingestion key",
      description:
        "Drop a write-only key into any agent's OTLP exporter to stream traces straight in.",
      onClick: () => scrollToId(PERSONAL_TRACE_INGEST_ANCHOR),
    },
    {
      icon: KeyRound,
      title: "Create an API key",
      description: "Authenticate the LangWatch SDK or your own integration.",
      ...(projectSlug
        ? { href: `/${projectSlug}/settings/api-keys` }
        : { onClick: () => scrollToId(PERSONAL_TRACE_INGEST_ANCHOR) }),
    },
  ];

  return (
    <IntegratePaneShell compact ariaLabel="Start sending your AI usage">
      <VStack align="stretch" gap={6}>
        <VStack align="start" gap={1.5}>
          <Text
            textStyle="2xl"
            fontWeight="600"
            color="fg"
            letterSpacing="-0.015em"
          >
            No activity here yet
          </Text>
          <Text textStyle="sm" color="fg.muted" lineHeight="tall">
            Send your AI usage to LangWatch with the tools you already have set
            up above — no SDK wiring required.
          </Text>
        </VStack>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={3}>
          {offers.map((offer) => (
            <OfferCard key={offer.title} {...offer} />
          ))}
        </SimpleGrid>
      </VStack>
    </IntegratePaneShell>
  );
}
