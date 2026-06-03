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
import { Bot, Check, MousePointer2, Terminal, Users } from "lucide-react";
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
 * Install fires `api.userIngestionBindings.install` mutation. The
 * plaintext ik-lw-<base32> token is shown ONCE in the drawer and stored
 * in component state for the session — bindings list query tells us
 * which templates are installed (drives green-check), but the token
 * doesn't survive page reload (matches "shown once" UX).
 *
 * raw_otlp_advanced is rendered as a SEPARATE static tile (no
 * IngestionTemplate row, no install). It deep-links to
 * /me/configure#otlp — the BYO-OTLP fallback discovery card.
 *
 * Claude Code is intentionally excluded from this grid (filtered by
 * slug below). The unified entry point for Claude Code lives on the
 * AiToolsPortal "$ langwatch claude" tile — the CLI auto-mints the
 * ingestion token and wires both the gateway and OTLP paths in one
 * step, so a separate "Connect" tile here would be a duplicate UX.
 *
 * Per the no-leak invariant in catalog.feature: this component MUST
 * NOT render under /[project] chrome — only on /me. Embedding lives on
 * /me/index.tsx.
 */
const TILE_META: Record<
  string,
  { icon: ReactNode; subtitle: string }
> = {
  cursor: {
    icon: <MousePointer2 size={20} />,
    subtitle: "Cursor IDE telemetry",
  },
  claude_cowork: {
    icon: <Users size={20} />,
    subtitle: "Multi-agent Claude sessions",
  },
};

const UNIFIED_VIA_CLI_SLUGS = new Set(["claude_code"]);

const FALLBACK_ICON = <Bot size={20} />;

export function TraceIngestSection() {
  const ctx = usePersonalContext();
  const orgId = ctx.organizationId ?? "";

  const templatesQuery = api.ingestionTemplates.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const bindingsQuery = api.userIngestionBindings.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const utils = api.useUtils();
  const installMutation = api.userIngestionBindings.install.useMutation({
    onSuccess: () => {
      void utils.userIngestionBindings.list.invalidate();
    },
    onError: (err) => {
      toaster.create({
        title: "Install failed",
        description: err.message,
        type: "error",
      });
    },
  });
  const rotateMutation = api.userIngestionBindings.rotateToken.useMutation({
    onSuccess: () => {
      void utils.userIngestionBindings.list.invalidate();
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

  const templates = (templatesQuery.data ?? []).filter(
    (t) => !UNIFIED_VIA_CLI_SLUGS.has(t.slug),
  );
  const bindings = bindingsQuery.data ?? [];

  const bindingByTemplateId = new Map(bindings.map((b) => [b.templateId, b]));
  const openTemplate = openSlug
    ? templates.find((t) => t.slug === openSlug) ?? null
    : null;

  const handleInstall = async (templateId: string, slug: string) => {
    try {
      const result = await installMutation.mutateAsync({
        organizationId: orgId,
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

  const handleRotate = async (bindingId: string, slug: string) => {
    try {
      const result = await rotateMutation.mutateAsync({
        organizationId: orgId,
        bindingId,
      });
      setInstallResults((s) => ({
        ...s,
        [slug]: { token: result.token, endpoint: otlpEndpoint },
      }));
    } catch {
      // surfaced via toaster + drawer error state
    }
  };

  const handleTileClick = (templateId: string, slug: string) => {
    setOpenSlug(slug);
    const isAlreadyBound = bindingByTemplateId.has(templateId);
    if (
      !isAlreadyBound &&
      !installResults[slug] &&
      !installMutation.isPending
    ) {
      void handleInstall(templateId, slug);
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
              const binding = bindingByTemplateId.get(t.id);
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
                  installed={!!binding}
                  onClick={() => handleTileClick(t.id, t.slug)}
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
            installMutation.variables?.templateId === openTemplate.id
              ? installMutation.error.message
              : rotateMutation.error?.message ?? null
          }
          hasExistingBinding={bindingByTemplateId.has(openTemplate.id)}
          onInstall={() => void handleInstall(openTemplate.id, openTemplate.slug)}
          onRotate={() => {
            const existing = bindingByTemplateId.get(openTemplate.id);
            if (existing) void handleRotate(existing.id, openTemplate.slug);
          }}
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
