import {
  Badge,
  Box,
  Button,
  EmptyState,
  HStack,
  Spacer,
  Spinner,
  Switch,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Archive,
  MoreVertical,
  Pencil,
  Plus,
  Zap,
} from "lucide-react";
import { useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { CacheRuleCreateDrawer } from "~/components/gateway/CacheRuleCreateDrawer";
import { CacheRuleEditDrawer } from "~/components/gateway/CacheRuleEditDrawer";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type CacheRuleListRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  priority: number;
  enabled: boolean;
  matchers: unknown;
  action: unknown;
  modeEnum: "RESPECT" | "FORCE" | "DISABLE";
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function CacheRulesPage() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const canCreate = hasPermission("gatewayCacheRules:create");
  const canUpdate = hasPermission("gatewayCacheRules:update");
  const canDelete = hasPermission("gatewayCacheRules:delete");

  const listQuery = api.gatewayCacheRules.list.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization?.id },
  );
  const utils = api.useContext();

  const archiveMutation = api.gatewayCacheRules.archive.useMutation({
    onSuccess: async () => {
      if (organization?.id) {
        await utils.gatewayCacheRules.list.invalidate({
          organizationId: organization.id,
        });
      }
    },
  });

  const toggleEnabledMutation = api.gatewayCacheRules.update.useMutation({
    onSuccess: async () => {
      if (organization?.id) {
        await utils.gatewayCacheRules.list.invalidate({
          organizationId: organization.id,
        });
      }
    },
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CacheRuleListRow | null>(null);
  const [archiving, setArchiving] = useState<CacheRuleListRow | null>(null);

  const confirmArchive = async () => {
    if (!archiving || !organization) return;
    try {
      await archiveMutation.mutateAsync({
        organizationId: organization.id,
        id: archiving.id,
      });
      setArchiving(null);
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : "Failed to archive",
        type: "error",
      });
    }
  };

  const toggleEnabled = async (rule: CacheRuleListRow) => {
    if (!organization) return;
    try {
      await toggleEnabledMutation.mutateAsync({
        organizationId: organization.id,
        id: rule.id,
        enabled: !rule.enabled,
      });
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : "Failed to toggle rule",
        type: "error",
      });
    }
  };

  const rows = listQuery.data ?? [];

  return (
    <GatewayLayout>
      <>
        <PageLayout.Header>
          <PageLayout.Heading>Cache control</PageLayout.Heading>
          <Spacer />
          {canCreate && (
            <Button
              colorPalette="orange"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={14} /> New rule
            </Button>
          )}
        </PageLayout.Header>

        <Box padding={6}>
          <Text fontSize="sm" color="fg.muted" mb={4}>
            Rules are evaluated first-match-wins by priority (highest first).
            A per-request <code>X-LangWatch-Cache</code> header always wins
            over matching rules, and a matched rule always wins over the
            per-virtual-key default. Changes propagate to the gateway within
            30 s via the /changes long-poll.
          </Text>
          {listQuery.isLoading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <Zap size={32} />
                </EmptyState.Indicator>
                <EmptyState.Title>No cache rules yet</EmptyState.Title>
                <EmptyState.Description>
                  Cache rules let operators force, disable, or override cache
                  behaviour across virtual keys, models, principals, or
                  custom request metadata — no client code changes required.
                </EmptyState.Description>
                {canCreate && (
                  <Button
                    colorPalette="orange"
                    onClick={() => setCreateOpen(true)}
                    mt={2}
                  >
                    <Plus size={14} /> New rule
                  </Button>
                )}
              </EmptyState.Content>
            </EmptyState.Root>
          ) : (
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="60px">
                    Priority
                  </Table.ColumnHeader>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Match</Table.ColumnHeader>
                  <Table.ColumnHeader>Action</Table.ColumnHeader>
                  <Table.ColumnHeader>Enabled</Table.ColumnHeader>
                  <Table.ColumnHeader></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((r) => (
                  <Table.Row key={r.id}>
                    <Table.Cell>
                      <Badge colorPalette="gray">{r.priority}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <VStack align="start" gap={0}>
                        <Text fontWeight="medium">{r.name}</Text>
                        {r.description && (
                          <Text fontSize="xs" color="fg.muted">
                            {r.description}
                          </Text>
                        )}
                      </VStack>
                    </Table.Cell>
                    <Table.Cell>
                      <MatcherSummary matchers={r.matchers} />
                    </Table.Cell>
                    <Table.Cell>
                      <ActionBadge
                        action={r.action}
                        modeEnum={r.modeEnum}
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Switch.Root
                        checked={r.enabled}
                        onCheckedChange={() => void toggleEnabled(r)}
                        disabled={!canUpdate}
                        size="sm"
                        colorPalette="orange"
                      >
                        <Switch.HiddenInput />
                        <Switch.Control />
                      </Switch.Root>
                    </Table.Cell>
                    <Table.Cell>
                      {(canUpdate || canDelete) && (
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-label="Actions"
                            >
                              <MoreVertical size={14} />
                            </Button>
                          </Menu.Trigger>
                          <Menu.Content>
                            {canUpdate && (
                              <Menu.Item
                                value="edit"
                                onClick={() => setEditing(r)}
                              >
                                <Pencil size={14} /> Edit
                              </Menu.Item>
                            )}
                            {canDelete && (
                              <Menu.Item
                                value="archive"
                                onClick={() => setArchiving(r)}
                              >
                                <Archive size={14} /> Archive
                              </Menu.Item>
                            )}
                          </Menu.Content>
                        </Menu.Root>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Box>
      </>

      <CacheRuleCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void listQuery.refetch();
        }}
      />
      <CacheRuleEditDrawer
        rule={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          void listQuery.refetch();
        }}
      />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={`Archive ${archiving?.name ?? "rule"}?`}
        message="The rule stops applying to new requests. Historical traces stay attributed to their rule id; the rule itself remains visible in the audit log."
        confirmLabel="Archive"
        tone="warning"
        loading={archiveMutation.isPending}
        onConfirm={confirmArchive}
      />
    </GatewayLayout>
  );
}

function MatcherSummary({ matchers }: { matchers: unknown }) {
  if (!matchers || typeof matchers !== "object") {
    return <Text fontSize="xs" color="fg.muted">any request</Text>;
  }
  const m = matchers as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof m.vk_id === "string") parts.push(`vk=${m.vk_id}`);
  if (typeof m.vk_prefix === "string") parts.push(`vk~${m.vk_prefix}*`);
  if (Array.isArray(m.vk_tags) && m.vk_tags.length > 0) {
    parts.push(`tags:[${m.vk_tags.join(",")}]`);
  }
  if (typeof m.principal_id === "string") parts.push(`user=${m.principal_id}`);
  if (typeof m.model === "string") parts.push(`model=${m.model}`);
  if (
    m.request_metadata &&
    typeof m.request_metadata === "object" &&
    !Array.isArray(m.request_metadata)
  ) {
    const keys = Object.keys(m.request_metadata as Record<string, unknown>);
    if (keys.length > 0) {
      parts.push(`meta:${keys.join(",")}`);
    }
  }
  if (parts.length === 0) {
    return <Text fontSize="xs" color="fg.muted">any request</Text>;
  }
  return (
    <HStack gap={1} flexWrap="wrap">
      {parts.map((p) => (
        <Badge key={p} colorPalette="gray" fontSize="2xs" variant="subtle">
          {p}
        </Badge>
      ))}
    </HStack>
  );
}

function ActionBadge({
  action,
  modeEnum,
}: {
  action: unknown;
  modeEnum: "RESPECT" | "FORCE" | "DISABLE";
}) {
  const a = (action ?? {}) as Record<string, unknown>;
  const tone =
    modeEnum === "FORCE"
      ? "orange"
      : modeEnum === "DISABLE"
        ? "red"
        : "green";
  return (
    <HStack gap={1}>
      <Badge colorPalette={tone}>{modeEnum.toLowerCase()}</Badge>
      {typeof a.ttl === "number" && (
        <Text fontSize="xs" color="fg.muted">
          ttl {a.ttl}s
        </Text>
      )}
      {typeof a.salt === "string" && a.salt.length > 0 && (
        <Text fontSize="xs" color="fg.muted">
          salted
        </Text>
      )}
    </HStack>
  );
}

export default withPermissionGuard("gatewayCacheRules:view", {
  layoutComponent: DashboardLayout,
})(CacheRulesPage);
