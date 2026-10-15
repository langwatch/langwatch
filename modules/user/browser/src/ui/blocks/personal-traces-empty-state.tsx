/**
 * Empty state for /me "Recent activity", with personal-user-specific trace sources.
 */
import { Card, CardGrid } from "@langwatch/design-system/card";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, Flex, Icon, VStack } from "@langwatch/design-system/primitives";
import { useProductAccent } from "@langwatch/design-system/use-product-accent";
import { docsUrl } from "@langwatch/handled-error/docs-url";
import { Activity, Bot, KeyRound, Webhook } from "lucide-react";
import type React from "react";

import { Link } from "../elements/personal-link.tsx";

/**
 * Where a reader mints an API key. `platform/app` exported the path from
 * `pages/settings/api-keys/apiKeyAnchor` together with the row-anchor helpers
 * this offer does not use; the address is the whole of what travels.
 */
const API_KEYS_SETTINGS_PATH = "/settings/api-keys";

/**
 * The compact half of the trace explorer's `IntegratePaneShell`, inlined —
 * the shell (under `platform/app`) takes a `chrome` slot and a full-viewport
 * branch this card never used; only the safe-centred hero box was needed.
 */
const CompactIntegratePane: React.FC<{ children: React.ReactNode; ariaLabel?: string }> = ({
  children,
  ariaLabel,
}) => (
  <Flex
    aria-label={ariaLabel}
    direction="column"
    flex={1}
    minWidth={0}
    overflow="hidden"
    position="relative"
  >
    <Flex
      flex={1}
      direction="column"
      justify="safe center"
      align="stretch"
      minHeight={0}
      position="relative"
      zIndex={1}
    >
      <Box width="full" maxWidth="760px" minWidth={0} marginX="auto" paddingX={6} paddingY={8}>
        {children}
      </Box>
    </Flex>
  </Flex>
);

/** Anchor ids the offers scroll to — set on the matching /me sections. */
export const PERSONAL_AI_TOOLS_ANCHOR = "me-ai-tools";
export const PERSONAL_TRACE_INGEST_ANCHOR = "me-trace-ingest";

function scrollToId(id: string) {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

type Offer = {
  icon: React.ElementType;
  title: string;
  description: string;
} & ({ onClick: () => void; href?: undefined } | { href: string; onClick?: undefined });

const OfferCard: React.FC<Offer> = ({ icon, title, description, onClick, href }) => {
  const accent = useProductAccent();
  return (
    <Card
      titleLevel={3}
      icon={<Icon as={icon} boxSize={5} color={accent.roles.solid} />}
      title={title}
      description={description}
      opener={
        href ? <Link href={href} /> : <button type="button" aria-label={title} onClick={onClick} />
      }
    />
  );
};

export function PersonalTracesEmptyState({ projectSlug }: { projectSlug?: string | null }) {
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
        ? { href: API_KEYS_SETTINGS_PATH }
        : { onClick: () => scrollToId(PERSONAL_TRACE_INGEST_ANCHOR) }),
    },
  ];

  return (
    <CompactIntegratePane ariaLabel="Start sending your AI usage">
      <VStack align="stretch" gap={6}>
        <NoDataInfoBlock
          size="inline"
          bordered={false}
          icon={<Activity />}
          title="No activity here yet"
          description="Send your AI usage to LangWatch with the tools you already have set up above - no SDK wiring required."
          next={[
            {
              kind: "docs",
              label: "Coding agents quickstart",
              href: docsUrl("/coding-agents/quickstart"),
            },
          ]}
        />
        <CardGrid columns={3}>
          {offers.map((offer) => (
            <OfferCard key={offer.title} {...offer} />
          ))}
        </CardGrid>
      </VStack>
    </CompactIntegratePane>
  );
}
