import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  SimpleGrid,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Bot, Check, MousePointer2, Terminal, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  IngestionTemplateInstallDrawer,
  type IngestionBindingResult,
  type IngestionTemplateMeta,
} from "~/components/me/IngestionTemplateInstallDrawer";
import { Link } from "~/components/ui/link";
import { usePublicEnv } from "~/hooks/usePublicEnv";

/**
 * /me Trace Ingest section — tile-grid for IngestionTemplate v1 catalog.
 *
 * Per `specs/ai-gateway/governance/ingestion-templates-catalog.feature`:
 *   exactly 4 visible tiles v1 — claude_code / cursor / claude_cowork
 *   (otlp_token install) + raw_otlp_advanced (visually distinct fallback
 *   discovery card pointing at /me/settings#otlp).
 *
 * Iter 3 wires the install drawer scaffold against a STUB onInstall.
 * Real wiring lands when `api.ingestionTemplates.list` +
 * `api.userIngestionBindings.install` ship — replace TEMPLATE_METADATA
 * with the tRPC list result, swap stub install with the real mutation.
 *
 * Per the no-leak invariant in catalog.feature:
 *   This component MUST NOT render under /[project] chrome — only on
 *   /me. Embedding lives on /me/index.tsx.
 */
const TEMPLATE_METADATA: Array<
  IngestionTemplateMeta & { subtitle: string; icon: ReactNode }
> = [
  {
    slug: "claude_code",
    displayName: "Claude Code",
    subtitle: "Anthropic Claude Code CLI",
    credentialSchema: null,
    icon: <Bot size={20} />,
  },
  {
    slug: "cursor",
    displayName: "Cursor",
    subtitle: "Cursor IDE telemetry",
    credentialSchema: null,
    icon: <MousePointer2 size={20} />,
  },
  {
    slug: "claude_cowork",
    displayName: "Claude cowork",
    subtitle: "Multi-agent Claude sessions",
    credentialSchema: null,
    icon: <Users size={20} />,
  },
];

export function TraceIngestSection() {
  const publicEnv = usePublicEnv();
  const baseHost = publicEnv.data?.BASE_HOST ?? "";

  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [installResults, setInstallResults] = useState<
    Record<string, IngestionBindingResult | null>
  >({});
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installErrors, setInstallErrors] = useState<
    Record<string, string | null>
  >({});

  const openTemplate = openSlug
    ? TEMPLATE_METADATA.find((t) => t.slug === openSlug) ?? null
    : null;

  /**
   * STUB install — wires to api.userIngestionBindings.install when
   * Sergey's tRPC router lands. Returns a synthetic token for UI
   * verification only; receiver path will reject this token until
   * the real mutation lands. NOT a security-relevant secret.
   */
  const stubInstall = async (slug: string): Promise<IngestionBindingResult> => {
    await new Promise((r) => setTimeout(r, 500));
    return {
      token: `lwub_${slug}_PENDING_BINDING_SERVICE`,
      endpoint: baseHost ? `${baseHost}/api/otel` : "/api/otel",
    };
  };

  const handleInstall = async (slug: string) => {
    setInstalling((s) => ({ ...s, [slug]: true }));
    setInstallErrors((s) => ({ ...s, [slug]: null }));
    try {
      const result = await stubInstall(slug);
      setInstallResults((s) => ({ ...s, [slug]: result }));
    } catch (err) {
      setInstallErrors((s) => ({
        ...s,
        [slug]: err instanceof Error ? err.message : "Install failed",
      }));
    } finally {
      setInstalling((s) => ({ ...s, [slug]: false }));
    }
  };

  const handleMarkInstalled = () => {
    setOpenSlug(null);
  };

  const handleOpenChange = (slug: string, next: boolean) => {
    if (!next) {
      setOpenSlug(null);
      // Keep installResults so the tile stays green-checked across
      // open/close — until the real tRPC list query lands and the
      // server is the source of truth.
    } else {
      setOpenSlug(slug);
    }
  };

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
        {TEMPLATE_METADATA.map((t) => (
          <InstallTile
            key={t.slug}
            slug={t.slug}
            label={t.displayName}
            subtitle={t.subtitle}
            icon={t.icon}
            installed={!!installResults[t.slug]}
            onClick={() => {
              setOpenSlug(t.slug);
              if (!installResults[t.slug] && !installing[t.slug]) {
                void handleInstall(t.slug);
              }
            }}
          />
        ))}
        <RawOtlpAdvancedTile />
      </SimpleGrid>

      {openTemplate && (
        <IngestionTemplateInstallDrawer
          open={!!openSlug}
          onOpenChange={(next) => handleOpenChange(openTemplate.slug, next)}
          template={openTemplate}
          installResult={installResults[openTemplate.slug] ?? null}
          isInstalling={!!installing[openTemplate.slug]}
          installError={installErrors[openTemplate.slug] ?? null}
          onInstall={() => void handleInstall(openTemplate.slug)}
          onMarkInstalled={handleMarkInstalled}
        />
      )}
    </VStack>
  );
}

function InstallTile({
  slug,
  label,
  subtitle,
  icon,
  installed,
  onClick,
}: {
  slug: string;
  label: string;
  subtitle: string;
  icon: ReactNode;
  installed: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      as="button"
      type="button"
      onClick={onClick}
      borderWidth="1px"
      borderColor={installed ? "green.300" : "border.muted"}
      borderRadius="md"
      padding={3}
      textAlign="left"
      _hover={{ borderColor: "border.emphasized", cursor: "pointer" }}
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
            {installed ? (
              <Badge size="xs" variant="surface" colorPalette="green">
                <Check size={10} /> Installed
              </Badge>
            ) : (
              <Badge size="xs" variant="surface" colorPalette="gray">
                Connect
              </Badge>
            )}
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
