import { Badge, Box, Heading, HStack, SimpleGrid, Spacer, Text, VStack } from "@chakra-ui/react";
import { Bot, Check, Terminal } from "lucide-react";
import { type ReactNode, useState } from "react";

import { api } from "../../behavior/personal-workspace-api";
import { usePersonalDeployment } from "../../behavior/personal-workspace-session";
import { usePersonalContext } from "../../behavior/use-personal-context";
import { Link } from "../elements/personal-link";
import {
  type IngestionBindingResult,
  IngestionTemplateInstallDrawer,
} from "./ingestion-template-install-drawer";

/**
 * /me Trace Ingest section, the tile-grid for the IngestionTemplate
 * catalog.
 *
 * Tile metadata comes from `api.ingestionTemplates.list` (server is the
 * source of truth: admin can disable / org-author / archive). The
 * platform ships NO default templates, so the whole section renders only
 * when the org has at least one template of its own. A heading over an
 * empty grid would read as a broken section on every fresh org's /me.
 *
 * Install fires `api.ingestionKey.install` mutation. The plaintext
 * sk-lw- token is shown ONCE in the drawer and stored in component state
 * for the session — the ingestion-keys list query tells us which sources
 * are connected (drives green-check), but the token doesn't survive page
 * reload (matches "shown once" UX).
 *
 * raw_otlp_advanced is rendered as a SEPARATE static tile (no
 * IngestionTemplate row, no install). It deep-links to
 * /me/configure#otlp, the BYO-OTLP fallback discovery card. It renders
 * only alongside real templates; the personal OTLP endpoint stays
 * reachable via /me/configure regardless.
 *
 * The platform's coding assistants (claude_code, codex, cursor, gemini,
 * opencode) never appear in this grid because they are not seeded as
 * ingestion templates at all — the `langwatch <tool>` command owns their
 * setup and the receiver converts their OTLP logs into canonical gen_ai
 * spans. Their entry points live on the AiToolsPortal "$ langwatch
 * <tool>" tiles. The grid simply renders whatever
 * `api.ingestionTemplates.list` returns (org-authored templates) plus
 * the raw_otlp_advanced discovery card, with no slug filter.
 *
 * Per the no-leak invariant in catalog.feature: this component MUST
 * NOT render under /[project] chrome — only on /me. Embedding lives on
 * /me/index.tsx.
 */
const FALLBACK_ICON = <Bot size={20} />;

/**
 * The mutation's error, but only if it was this template that raised it.
 *
 * `install` and `rotate` are one mutation each for the whole grid, and tRPC
 * keeps the last error until the next call — so the question a drawer has to
 * ask is never "did this fail" but "did this fail for the tool I'm showing".
 * `variables` is the request that failed, which is the only record of that.
 */
function errorFor<TError, TVariables extends { sourceType: string }>(
  mutation: { error: TError | null; variables?: TVariables },
  sourceType: string,
): TError | null {
  if (!mutation.error) return null;
  return mutation.variables?.sourceType === sourceType ? mutation.error : null;
}

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
  // Neither mutation toasts: both are driven from inside the install drawer,
  // which is open whenever they can fail and renders this same error inline
  // via `<HandledErrorAlert>`. A toast would report it a second time.
  const installMutation = api.ingestionKey.install.useMutation({
    onSuccess: () => {
      void utils.ingestionKey.list.invalidate();
    },
  });
  const rotateMutation = api.ingestionKey.rotate.useMutation({
    onSuccess: () => {
      void utils.ingestionKey.list.invalidate();
    },
  });

  const { appBaseUrl } = usePersonalDeployment();
  const otlpEndpoint = appBaseUrl ? `${appBaseUrl}/api/otel` : "/api/otel";

  const [openSlug, setOpenSlug] = useState<string | null>(null);
  /** Per-session install results, keyed by slug. Cleared on reload. */
  const [installResults, setInstallResults] = useState<
    Record<string, IngestionBindingResult | null>
  >({});

  const templates = templatesQuery.data ?? [];
  const keys = keysQuery.data ?? [];

  /** Connected ingestion keys, keyed by the source they were minted for. */
  const keyBySourceType = new Map(keys.map((k) => [k.sourceType, k]));

  // No templates, no section: the platform ships no defaults, so most
  // orgs have nothing to install here. Rendering nothing (not even
  // load skeletons) while the list is in flight keeps /me from flashing
  // a section that then disappears, and only a SUCCESSFUL empty list
  // hides the section for good. A failed list is NOT an empty catalog:
  // it falls through to the normal render (heading, grid, raw-OTLP
  // fallback card) rather than silently hiding the section. Installed
  // sources keep ingesting regardless: the receiver keys on the
  // IngestionSource, not on a listed template.
  if (!templatesQuery.isSuccess && !templatesQuery.isError) return null;
  if (templatesQuery.isSuccess && templates.length === 0) return null;
  const openTemplate = openSlug ? (templates.find((t) => t.slug === openSlug) ?? null) : null;

  const handleInstall = async (sourceType: string, templateId: string, slug: string) => {
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
      // surfaced inline by the drawer, off `installMutation.error`
    }
  };

  const handleRotate = async (sourceType: string, templateId: string, slug: string) => {
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
      // surfaced inline by the drawer, off `rotateMutation.error`
    }
  };

  const handleTileClick = (sourceType: string, templateId: string, slug: string) => {
    setOpenSlug(slug);
    const isAlreadyConnected = keyBySourceType.has(sourceType);
    if (!isAlreadyConnected && !installResults[slug] && !installMutation.isPending) {
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
          Connect your tools so their traces land in your personal workspace, with cost, tokens, and
          model filled in for you.
        </Text>
      </VStack>

      <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} gap={3}>
        {templates.map((t) => (
          <InstallTile
            key={t.id}
            slug={t.slug}
            label={t.displayName}
            subtitle={t.description ?? t.sourceType}
            icon={FALLBACK_ICON}
            installed={keyBySourceType.has(t.sourceType)}
            onClick={() => handleTileClick(t.sourceType, t.id, t.slug)}
          />
        ))}
        <RawOtlpAdvancedTile />
      </SimpleGrid>

      {openTemplate && (
        <IngestionTemplateInstallDrawer
          open={!!openSlug}
          onOpenChange={(next) => handleOpenChange(openTemplate.slug, next)}
          template={{
            slug: openTemplate.slug,
            displayName: openTemplate.displayName,
            description: openTemplate.description,
            credentialSchema: openTemplate.credentialSchema,
          }}
          installResult={installResults[openTemplate.slug] ?? null}
          isInstalling={installMutation.isPending || rotateMutation.isPending}
          // Both halves are gated on the template they belong to. A tRPC
          // mutation's `error` outlives the drawer that caused it, and these
          // two mutations are shared across every tile — so an ungated
          // fallback meant a failed rotate on one tool was still on screen
          // when you opened the next one's drawer, reported as that tool's
          // failure. This drawer is the only place either failure is shown,
          // which makes showing the wrong one worse than showing none.
          installError={
            errorFor(installMutation, openTemplate.sourceType) ??
            errorFor(rotateMutation, openTemplate.sourceType)
          }
          hasExistingKey={keyBySourceType.has(openTemplate.sourceType)}
          onInstall={() =>
            void handleInstall(openTemplate.sourceType, openTemplate.id, openTemplate.slug)
          }
          onRotate={() =>
            void handleRotate(openTemplate.sourceType, openTemplate.id, openTemplate.slug)
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
          <Link href="/me/configure#otlp" color="orange.600" fontSize="xs" fontWeight="medium">
            Get OTLP token →
          </Link>
        </VStack>
      </HStack>
    </Box>
  );
}
