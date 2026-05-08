import {
  Badge,
  Box,
  Heading,
  HStack,
  SimpleGrid,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Bot, MousePointer2, Terminal, Users } from "lucide-react";
import type { ReactNode } from "react";

import { Link } from "~/components/ui/link";

/**
 * /me Trace Ingest section — tile-grid for IngestionTemplate v1 catalog.
 *
 * Per `specs/ai-gateway/governance/ingestion-templates-catalog.feature`:
 *   exactly 4 visible tiles v1 — claude_code / cursor / claude_cowork
 *   (otlp_token install) + raw_otlp_advanced (visually distinct fallback
 *   discovery card pointing at /me/settings#otlp).
 *
 * v1 ships catalog-shape only — install drawers wire up next iter when
 * Sergey's IngestionTemplate Prisma model + tRPC list query land. Tiles
 * render disabled until then; raw_otlp_advanced is functional today
 * because it deep-links to the /me/settings 'Personal OTLP Endpoint'
 * panel which already ships (33c258d8a).
 *
 * Per the no-leak invariant in catalog.feature:
 *   This component MUST NOT render under /[project] chrome — only on
 *   /me. Embedding lives on /me/index.tsx.
 */
export function TraceIngestSection() {
  return (
    <VStack align="stretch" gap={3} width="full">
      <VStack align="start" gap={0}>
        <Heading as="h3" size="md">
          Trace Ingest
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          Connect your tools to flow traces into your personal workspace.
          Templates pre-shape upstream spans into the LangWatch canonical
          gen_ai.* form so cost, tokens, and model populate automatically.
        </Text>
      </VStack>

      <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} gap={3}>
        <PlaceholderInstallTile
          slug="claude_code"
          label="Claude Code"
          subtitle="Anthropic Claude Code CLI"
          icon={<Bot size={20} />}
        />
        <PlaceholderInstallTile
          slug="cursor"
          label="Cursor"
          subtitle="Cursor IDE telemetry"
          icon={<MousePointer2 size={20} />}
        />
        <PlaceholderInstallTile
          slug="claude_cowork"
          label="Claude cowork"
          subtitle="Multi-agent Claude sessions"
          icon={<Users size={20} />}
        />
        <RawOtlpAdvancedTile />
      </SimpleGrid>
    </VStack>
  );
}

function PlaceholderInstallTile({
  slug,
  label,
  subtitle,
  icon,
}: {
  slug: string;
  label: string;
  subtitle: string;
  icon: ReactNode;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      data-tile-slug={slug}
    >
      <HStack alignItems="start" gap={3}>
        <Box
          width="36px"
          height="36px"
          flexShrink={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
          color="fg.muted"
          borderRadius="sm"
          backgroundColor="bg.subtle"
        >
          {icon}
        </Box>
        <VStack align="start" gap={0} flex={1} minWidth={0}>
          <HStack gap={2} width="full">
            <Text fontSize="sm" fontWeight="medium">
              {label}
            </Text>
            <Spacer />
            <Badge size="xs" variant="surface" colorPalette="gray">
              Soon
            </Badge>
          </HStack>
          <Text fontSize="xs" color="fg.muted" lineClamp={2}>
            {subtitle}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}

function RawOtlpAdvancedTile() {
  return (
    <Box
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.emphasized"
      borderRadius="md"
      padding={3}
      backgroundColor="bg.subtle"
      data-tile-slug="raw_otlp_advanced"
    >
      <HStack alignItems="start" gap={3}>
        <Box
          width="36px"
          height="36px"
          flexShrink={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
          color="fg.muted"
          borderRadius="sm"
          backgroundColor="bg.muted"
        >
          <Terminal size={20} />
        </Box>
        <VStack align="start" gap={1} flex={1} minWidth={0}>
          <Text fontSize="sm" fontWeight="medium">
            Raw OTLP (advanced)
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Bring your own OTLP — raw shape. Use for custom telemetry pipelines.
          </Text>
          <Link
            href="/me/settings#otlp"
            color="orange.600"
            fontSize="xs"
            fontWeight="medium"
          >
            Get OTLP token →
          </Link>
        </VStack>
      </HStack>
    </Box>
  );
}
