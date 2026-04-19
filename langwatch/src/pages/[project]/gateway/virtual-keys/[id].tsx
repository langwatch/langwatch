import {
  Badge,
  Box,
  Button,
  Code,
  HStack,
  Heading,
  Separator,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft, Pencil, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { VirtualKeyEditDrawer } from "~/components/gateway/VirtualKeyEditDrawer";
import { VirtualKeySecretReveal } from "~/components/gateway/VirtualKeySecretReveal";
import { Link } from "~/components/ui/link";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

function VirtualKeyDetailPage() {
  const { project, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const vkId = typeof router.query.id === "string" ? router.query.id : "";

  const detailQuery = api.virtualKeys.get.useQuery(
    { projectId: project?.id ?? "", id: vkId },
    { enabled: !!project?.id && !!vkId },
  );
  const utils = api.useContext();
  const rotateMutation = api.virtualKeys.rotate.useMutation({
    onSuccess: () =>
      utils.virtualKeys.get.invalidate({ projectId: project?.id, id: vkId }),
  });
  const revokeMutation = api.virtualKeys.revoke.useMutation({
    onSuccess: () =>
      utils.virtualKeys.get.invalidate({ projectId: project?.id, id: vkId }),
  });

  const [editing, setEditing] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revealSecret, setRevealSecret] = useState<{
    name: string;
    secret: string;
  } | null>(null);

  const canUpdate = hasPermission("virtualKeys:update");
  const canRotate = hasPermission("virtualKeys:rotate");

  const vk = detailQuery.data;

  const confirmRotate = async () => {
    if (!vk || !project) return;
    try {
      const result = await rotateMutation.mutateAsync({
        projectId: project.id,
        id: vk.id,
      });
      setRevealSecret({ name: vk.name, secret: result.secret });
      setRotating(false);
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to rotate key",
        type: "error",
      });
    }
  };

  const confirmRevoke = async () => {
    if (!vk || !project) return;
    try {
      await revokeMutation.mutateAsync({ projectId: project.id, id: vk.id });
      setRevoking(false);
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to revoke key",
        type: "error",
      });
    }
  };

  return (
    <GatewayLayout>
      <>
        <PageLayout.Header>
          <HStack>
            <Link
              href={`/${project?.slug}/gateway/virtual-keys`}
              color="fg.muted"
              fontSize="sm"
            >
              <HStack gap={1}>
                <ArrowLeft size={14} /> Virtual Keys
              </HStack>
            </Link>
          </HStack>
          <PageLayout.Heading>{vk?.name ?? "Virtual key"}</PageLayout.Heading>
          <Spacer />
          {vk?.status === "active" && (
            <HStack>
              {canUpdate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} /> Edit
                </Button>
              )}
              {canRotate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRotating(true)}
                >
                  <RotateCw size={14} /> Rotate
                </Button>
              )}
              {canUpdate && (
                <Button
                  colorPalette="red"
                  variant="outline"
                  size="sm"
                  onClick={() => setRevoking(true)}
                >
                  <Trash2 size={14} /> Revoke
                </Button>
              )}
            </HStack>
          )}
        </PageLayout.Header>

        <Box padding={6}>
          {detailQuery.isLoading ? (
            <Spinner />
          ) : !vk ? (
            <Text color="fg.muted">Virtual key not found.</Text>
          ) : (
            <VStack align="stretch" gap={6} maxWidth="900px">
              <Section title="Identity">
                <DetailRow label="ID">
                  <Code fontSize="xs">{vk.id}</Code>
                </DetailRow>
                <DetailRow label="Prefix">
                  <Code fontSize="xs">{vk.displayPrefix}…</Code>
                </DetailRow>
                <DetailRow label="Environment">
                  <Badge
                    colorPalette={vk.environment === "live" ? "green" : "gray"}
                  >
                    {vk.environment}
                  </Badge>
                </DetailRow>
                <DetailRow label="Status">
                  <Badge
                    colorPalette={vk.status === "active" ? "green" : "red"}
                  >
                    {vk.status}
                  </Badge>
                </DetailRow>
                {vk.description && (
                  <DetailRow label="Description">
                    <Text fontSize="sm">{vk.description}</Text>
                  </DetailRow>
                )}
              </Section>

              <Section title="Activity">
                <DetailRow label="Last used">
                  {vk.lastUsedAt ? (
                    <Tooltip content={new Date(vk.lastUsedAt).toLocaleString()}>
                      <Text fontSize="sm" color="fg.muted">
                        {formatTimeAgo(new Date(vk.lastUsedAt).getTime())}
                      </Text>
                    </Tooltip>
                  ) : (
                    <Text fontSize="sm" color="fg.muted">
                      never
                    </Text>
                  )}
                </DetailRow>
                <DetailRow label="Created">
                  <Tooltip content={new Date(vk.createdAt).toLocaleString()}>
                    <Text fontSize="sm" color="fg.muted">
                      {formatTimeAgo(new Date(vk.createdAt).getTime())}
                    </Text>
                  </Tooltip>
                </DetailRow>
                <DetailRow label="Revision">
                  <Text fontSize="sm" color="fg.muted">
                    {vk.revision}
                  </Text>
                </DetailRow>
              </Section>

              <Section title="Provider fallback chain">
                <ProviderChainTable
                  chain={vk.providerChain ?? []}
                  fallbackIds={vk.providerCredentialIds}
                />
              </Section>

              <ConfigurationSection config={vk.config as VkConfig | null} />
            </VStack>
          )}
        </Box>
      </>

      {project?.id && vk && (
        <VirtualKeyEditDrawer
          projectId={project.id}
          vk={editing ? (vk as any) : null}
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
          onSaved={() => {
            setEditing(false);
            void detailQuery.refetch();
          }}
        />
      )}
      <ConfirmDialog
        open={rotating}
        onOpenChange={setRotating}
        title={`Rotate ${vk?.name ?? "virtual key"}?`}
        message="A fresh secret will be minted and shown once. The current secret keeps working for 24h (grace window) so clients can roll over."
        confirmLabel="Rotate secret"
        tone="warning"
        loading={rotateMutation.isPending}
        onConfirm={confirmRotate}
      />
      <ConfirmDialog
        open={revoking}
        onOpenChange={setRevoking}
        title={`Revoke ${vk?.name ?? "virtual key"}?`}
        message="Clients using this key start receiving 401s within ~60 seconds. This cannot be undone — revoked keys are never reactivated."
        confirmLabel="Revoke key"
        tone="danger"
        loading={revokeMutation.isPending}
        onConfirm={confirmRevoke}
      />
      <VirtualKeySecretReveal
        open={!!revealSecret}
        onClose={() => setRevealSecret(null)}
        keyName={revealSecret?.name ?? ""}
        secret={revealSecret?.secret ?? ""}
      />
    </GatewayLayout>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Heading size="sm" mb={2}>
        {title}
      </Heading>
      <Separator mb={3} />
      <VStack align="stretch" gap={2}>
        {children}
      </VStack>
    </Box>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <HStack gap={4} align="flex-start">
      <Text fontSize="sm" color="fg.muted" minWidth="140px">
        {label}
      </Text>
      {children}
    </HStack>
  );
}

type VkConfig = {
  modelAliases?: Record<string, string>;
  modelsAllowed?: string[] | null;
  cache?: { mode?: "respect" | "force" | "disable"; ttlS?: number };
  rateLimits?: { rpm?: number | null; tpm?: number | null; rpd?: number | null };
  blockedPatterns?: {
    tools?: { deny?: string[]; allow?: string[] | null };
    mcp?: { deny?: string[]; allow?: string[] | null };
    urls?: { deny?: string[]; allow?: string[] | null };
    models?: { deny?: string[]; allow?: string[] | null };
  };
  guardrails?: {
    pre?: unknown[];
    post?: unknown[];
    streamChunk?: unknown[];
  };
  metadata?: { tags?: string[] };
};

type ChainEntry = {
  providerCredentialId: string;
  slot: string;
  providerType: string;
};

type ProviderKey = keyof typeof modelProviderIcons;

function resolveIcon(providerType: string): React.ReactNode | null {
  if (!providerType) return null;
  if (providerType in modelProviderIcons) {
    return modelProviderIcons[providerType as ProviderKey];
  }
  return null;
}

function ProviderChainTable({
  chain,
  fallbackIds,
}: {
  chain: ChainEntry[];
  fallbackIds: string[];
}) {
  // Router's `get` procedure populates providerChain with enriched
  // info (slot + providerType); list/create/rotate may not. Fall
  // back to raw IDs if the enriched shape isn't present — keeps the
  // panel rendering through transient states.
  const rows: ChainEntry[] =
    chain.length > 0
      ? chain
      : fallbackIds.map((id, idx) => ({
          providerCredentialId: id,
          slot: idx === 0 ? "primary" : `fallback-${idx}`,
          providerType: "",
        }));

  if (rows.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No providers bound.
      </Text>
    );
  }

  return (
    <Table.Root size="sm">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Order</Table.ColumnHeader>
          <Table.ColumnHeader>Provider</Table.ColumnHeader>
          <Table.ColumnHeader>Slot</Table.ColumnHeader>
          <Table.ColumnHeader>Credential ID</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((entry, idx) => {
          const Icon = resolveIcon(entry.providerType);
          return (
            <Table.Row key={entry.providerCredentialId}>
              <Table.Cell>
                <Badge colorPalette="orange">#{idx + 1}</Badge>
              </Table.Cell>
              <Table.Cell>
                <HStack gap={2}>
                  {Icon}
                  <Text fontSize="sm" fontWeight="medium">
                    {entry.providerType || "—"}
                  </Text>
                </HStack>
              </Table.Cell>
              <Table.Cell>
                <Badge variant="subtle" colorPalette="gray">
                  {entry.slot}
                </Badge>
              </Table.Cell>
              <Table.Cell>
                <Code fontSize="xs">{entry.providerCredentialId}</Code>
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table.Root>
  );
}

function ConfigurationSection({ config }: { config: VkConfig | null }) {
  if (!config) return null;

  const tags = config.metadata?.tags ?? [];
  const cacheMode = config.cache?.mode ?? "respect";
  const rpm = config.rateLimits?.rpm ?? null;
  const rpd = config.rateLimits?.rpd ?? null;
  const aliasCount = Object.keys(config.modelAliases ?? {}).length;

  const blockedCount = (["tools", "mcp", "urls", "models"] as const).reduce(
    (sum, dim) => {
      const bp = config.blockedPatterns?.[dim];
      return sum + (bp?.deny?.length ?? 0);
    },
    0,
  );

  const guardrailCount =
    (config.guardrails?.pre?.length ?? 0) +
    (config.guardrails?.post?.length ?? 0) +
    (config.guardrails?.streamChunk?.length ?? 0);

  const cacheTone =
    cacheMode === "force" ? "orange" : cacheMode === "disable" ? "red" : "green";

  return (
    <Section title="Configuration">
      {tags.length > 0 && (
        <DetailRow label="Tags">
          <HStack gap={1} flexWrap="wrap">
            {tags.map((t) => (
              <Badge key={t} variant="subtle" colorPalette="gray" fontSize="2xs">
                {t}
              </Badge>
            ))}
          </HStack>
        </DetailRow>
      )}
      <DetailRow label="Cache mode">
        <HStack gap={1}>
          <Badge colorPalette={cacheTone}>{cacheMode}</Badge>
          {cacheMode === "force" && (
            <Text fontSize="xs" color="fg.muted">
              ttl {config.cache?.ttlS ?? 3600}s
            </Text>
          )}
        </HStack>
      </DetailRow>
      <DetailRow label="Rate limits">
        <HStack gap={1} flexWrap="wrap">
          <Badge variant="outline" fontSize="2xs">
            rpm {rpm ?? "∞"}
          </Badge>
          <Badge variant="outline" fontSize="2xs">
            rpd {rpd ?? "∞"}
          </Badge>
        </HStack>
      </DetailRow>
      <DetailRow label="Model aliases">
        <Text fontSize="sm" color={aliasCount > 0 ? undefined : "fg.muted"}>
          {aliasCount > 0 ? `${aliasCount} rewrite${aliasCount > 1 ? "s" : ""}` : "—"}
        </Text>
      </DetailRow>
      <DetailRow label="Blocked patterns">
        <Text
          fontSize="sm"
          color={blockedCount > 0 ? undefined : "fg.muted"}
        >
          {blockedCount > 0
            ? `${blockedCount} deny rule${blockedCount > 1 ? "s" : ""} across tools / mcp / urls / models`
            : "—"}
        </Text>
      </DetailRow>
      <DetailRow label="Guardrails">
        <Text
          fontSize="sm"
          color={guardrailCount > 0 ? undefined : "fg.muted"}
        >
          {guardrailCount > 0
            ? `${guardrailCount} monitor${guardrailCount > 1 ? "s" : ""} attached (pre/post/stream_chunk)`
            : "—"}
        </Text>
      </DetailRow>
    </Section>
  );
}

export default withPermissionGuard("virtualKeys:view", {
  layoutComponent: DashboardLayout,
})(VirtualKeyDetailPage);
