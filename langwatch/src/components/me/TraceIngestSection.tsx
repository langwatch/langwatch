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
import { Bot, Check, Terminal, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  IngestionTemplateInstallDrawer,
  type IngestionBindingResult,
} from "~/components/me/IngestionTemplateInstallDrawer";
import { usePersonalContext } from "~/components/me/usePersonalContext";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";

/**
 * /me Trace Ingest section — tile-grid for IngestionTemplate v1 catalog.
 *
 * Tile metadata comes from `api.ingestionTemplates.list` (server is the
 * source of truth — admin can disable / org-author / archive). v1
 * platform-published rows are seeded by Sergey's seeders. Per-template
 * iconography is resolved client-side from a slug map since v1 platform
 * defaults ship with iconAsset=NULL.
 *
 * Install fires `api.ingestionKey.install` mutation. The plaintext
 * sk-lw- token is shown ONCE in the drawer and stored in component state
 * for the session — the ingestion-keys list query tells us which sources
 * are connected (drives green-check), but the token doesn't survive page
 * reload (matches "shown once" UX).
 *
 * raw_otlp_advanced is rendered as a SEPARATE static tile (no
 * IngestionTemplate row, no install). It deep-links to
 * /me/configure#otlp — the BYO-OTLP fallback discovery card.
 *
 * The platform's coding assistants (claude_code, codex, cursor, gemini,
 * opencode) never appear in this grid because they are not seeded as
 * ingestion templates at all — the `langwatch <tool>` command owns their
 * setup and the receiver converts their OTLP logs into canonical gen_ai
 * spans. Their entry points live on the AiToolsPortal "$ langwatch
 * <tool>" tiles. The grid simply renders whatever
 * `api.ingestionTemplates.list` returns (claude_cowork + any org-authored
 * templates) plus the raw_otlp_advanced discovery card — no slug filter.
 *
 * Per the no-leak invariant in catalog.feature: this component MUST
 * NOT render under /[project] chrome — only on /me. Embedding lives on
 * /me/index.tsx.
 */
const TILE_META: Record<
  string,
  { icon: ReactNode; subtitle: string }
> = {
  claude_cowork: {
    icon: <Users size={20} />,
    subtitle: "Multi-agent Claude sessions",
  },
};

const FALLBACK_ICON = <Bot size={20} />;

export function TraceIngestSection() {
  const ctx = usePersonalContext();
  const orgId = ctx.organizationId ?? "";

  const templatesQuery = api.ingestionTemplates.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const keysQuery = api.ingestionKey.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const utils = api.useUtils();
  const installMutation = api.ingestionKey.install.useMutation({
    onSuccess: () => {
      void utils.ingestionKey.list.invalidate();
    },
    onError: (err) => {
      toaster.create({
        title: "Install failed",
        description: err.message,
        type: "error",
      });
    },
  });
  const rotateMutation = api.ingestionKey.rotate.useMutation({
    onSuccess: () => {
      void utils.ingestionKey.list.invalidate();
    },
    onError: (err) => {
      toaster.create({
        title: "Rotate failed",
        description: err.message,
        type: "error",
      });
    },
  });

  const publicEnv = usePublicEnv();
  const otlpEndpoint = publicEnv.data?.BASE_HOST
    ? `${publicEnv.data.BASE_HOST}/api/otel`
    : "/api/otel";

  const [openSlug, setOpenSlug] = useState<string | null>(null);
  /** Per-session install results, keyed by slug. Cleared on reload. */
  const [installResults, setInstallResults] = useState<
    Record<string, IngestionBindingResult | null>
  >({});

  const templates = templatesQuery.data ?? [];
  const keys = keysQuery.data ?? [];

  /** Connected ingestion keys, keyed by the source they were minted for. */
  const keyBySourceType = new Map(keys.map((k) => [k.sourceType, k]));
  const openTemplate = openSlug
    ? templates.find((t) => t.slug === openSlug) ?? null
    : null;

  const handleInstall = async (
    sourceType: string,
    templateId: string,
    slug: string,
  ) => {
    try {
      const result = await installMutation.mutateAsync({
        organizationId: orgId,
        sourceType,
        templateId,
      });
      setInstallResults((s) => ({
        ...s,
        [slug]: { token: result.token, endpoint: otlpEndpoint },
      }));
    } catch {
      // surfaced via toaster + drawer error state
    }
  };

  const handleRotate = async (
    sourceType: string,
    templateId: string,
    slug: string,
  ) => {
    try {
      const result = await rotateMutation.mutateAsync({
        organizationId: orgId,
        sourceType,
        templateId,
      });
      setInstallResults((s) => ({
        ...s,
        [slug]: { token: result.token, endpoint: otlpEndpoint },
      }));
    } catch {
      // surfaced via toaster + drawer error state
    }
  };

  const handleTileClick = (
    sourceType: string,
    templateId: string,
    slug: string,
  ) => {
    setOpenSlug(slug);
    const isAlreadyConnected = keyBySourceType.has(sourceType);
    if (
      !isAlreadyConnected &&
      !installResults[slug] &&
      !installMutation.isPending
    ) {
      void handleInstall(sourceType, templateId, slug);
    }
  };

  const handleMarkInstalled = () => {
    setOpenSlug(null);
  };

  const handleOpenChange = (slug: string, next: boolean) => {
    if (!next) {
      setOpenSlug(null);
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
        {templatesQuery.isLoading
          ? Array.from({ length: 3 }).map((_, idx) => (
              <TileSkeleton key={`skeleton-${idx}`} />
            ))
          : templates.map((t) => {
              const connected = keyBySourceType.has(t.sourceType);
              const meta = TILE_META[t.slug] ?? {
                icon: FALLBACK_ICON,
                subtitle: t.description ?? t.sourceType,
              };
              return (
                <InstallTile
                  key={t.id}
                  slug={t.slug}
                  label={t.displayName}
                  subtitle={meta.subtitle}
                  icon={meta.icon}
                  installed={connected}
                  onClick={() => handleTileClick(t.sourceType, t.id, t.slug)}
                />
              );
            })}
        <RawOtlpAdvancedTile />
      </SimpleGrid>

      {openTemplate && (
        <IngestionTemplateInstallDrawer
          open={!!openSlug}
          onOpenChange={(next) =>
            handleOpenChange(openTemplate.slug, next)
          }
          template={{
            slug: openTemplate.slug,
            displayName: openTemplate.displayName,
            description: openTemplate.description,
            credentialSchema: openTemplate.credentialSchema,
          }}
          installResult={installResults[openTemplate.slug] ?? null}
          isInstalling={installMutation.isPending || rotateMutation.isPending}
          installError={
            installMutation.error?.message &&
            installMutation.variables?.sourceType === openTemplate.sourceType
              ? installMutation.error.message
              : rotateMutation.error?.message ?? null
          }
          hasExistingKey={keyBySourceType.has(openTemplate.sourceType)}
          onInstall={() =>
            void handleInstall(
              openTemplate.sourceType,
              openTemplate.id,
              openTemplate.slug,
            )
          }
          onRotate={() =>
            void handleRotate(
              openTemplate.sourceType,
              openTemplate.id,
              openTemplate.slug,
            )
          }
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
      // Chakra v3 typing for `as` doesn't surface native button props on Box.
      // Spread is necessary so React forwards `type="button"` to the rendered
      // <button>, preventing the default form-submit behavior.
      {...({ type: "button" } as { type: "button" })}
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

function TileSkeleton() {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      height="76px"
      backgroundColor="bg.subtle"
    />
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
            Bring your own OTLP, raw shape. Use for custom telemetry pipelines.
          </Text>
          <Link
            href="/me/configure#otlp"
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
