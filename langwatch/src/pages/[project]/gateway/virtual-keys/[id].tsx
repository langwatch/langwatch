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
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

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
      <PageLayout.Container>
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
                  <Text fontSize="sm" color="fg.muted">
                    {vk.lastUsedAt
                      ? new Date(vk.lastUsedAt).toLocaleString()
                      : "never"}
                  </Text>
                </DetailRow>
                <DetailRow label="Created">
                  <Text fontSize="sm" color="fg.muted">
                    {new Date(vk.createdAt).toLocaleString()}
                  </Text>
                </DetailRow>
                <DetailRow label="Revision">
                  <Text fontSize="sm" color="fg.muted">
                    {vk.revision}
                  </Text>
                </DetailRow>
              </Section>

              <Section title="Provider fallback chain">
                {vk.providerCredentialIds.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    No providers bound.
                  </Text>
                ) : (
                  <Table.Root size="sm">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>Order</Table.ColumnHeader>
                        <Table.ColumnHeader>Credential ID</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {vk.providerCredentialIds.map((id, idx) => (
                        <Table.Row key={id}>
                          <Table.Cell>
                            <Badge colorPalette="orange">#{idx + 1}</Badge>
                          </Table.Cell>
                          <Table.Cell>
                            <Code fontSize="xs">{id}</Code>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                )}
              </Section>
            </VStack>
          )}
        </Box>
      </PageLayout.Container>

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

export default withPermissionGuard("virtualKeys:view", {
  layoutComponent: DashboardLayout,
})(VirtualKeyDetailPage);
