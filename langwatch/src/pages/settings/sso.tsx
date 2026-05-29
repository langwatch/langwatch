import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Input,
  Separator,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Edit2,
  ExternalLink,
  MoreVertical,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import SettingsLayout from "~/components/SettingsLayout";
import {
  SsoConnectionModal,
  type SsoConnectionListItem,
} from "~/components/settings/SsoConnectionModal";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { ContactSalesBlock } from "~/components/subscription/ContactSalesBlock";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const MOCK_SCIM_LOGS = [
  {
    id: "1",
    time: "2 min ago",
    method: "POST",
    path: "/Users",
    status: 201,
    duration: 45,
  },
  {
    id: "2",
    time: "5 min ago",
    method: "PATCH",
    path: "/Users/abc123",
    status: 200,
    duration: 32,
  },
  {
    id: "3",
    time: "1 hour ago",
    method: "POST",
    path: "/Groups",
    status: 201,
    duration: 67,
  },
];

type ScimLogFilter = "all" | "success" | "4xx" | "5xx";

function statusColor(status: number) {
  if (status >= 200 && status < 300) return "green";
  if (status >= 400 && status < 500) return "yellow";
  return "red";
}

function providerLabel(provider: string) {
  const map: Record<string, string> = {
    okta: "Okta",
    "azure-ad": "Azure AD",
    google: "Google",
    "custom-oidc": "Custom OIDC",
    "custom-saml": "Custom SAML",
  };
  return map[provider] ?? provider;
}

function SsoSettings() {
  const { organization } = useOrganizationTeamProject();
  const { isEnterprise } = useActivePlan();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] =
    useState<SsoConnectionListItem | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<SsoConnectionListItem | null>(null);
  const [scimFilter, setScimFilter] = useState<ScimLogFilter>("all");
  const [scimSearch, setScimSearch] = useState("");

  const connectionsQuery = api.ssoConnection.list.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization?.id },
  );

  const createMutation = api.ssoConnection.create.useMutation({
    onSuccess: () => {
      void connectionsQuery.refetch();
      setModalOpen(false);
      setEditingConnection(null);
      toaster.create({ title: "SSO connection created", type: "success" });
    },
    onError: (error) => {
      toaster.create({ title: error.message, type: "error" });
    },
  });

  const updateMutation = api.ssoConnection.update.useMutation({
    onSuccess: () => {
      void connectionsQuery.refetch();
      setModalOpen(false);
      setEditingConnection(null);
      toaster.create({ title: "SSO connection updated", type: "success" });
    },
    onError: (error) => {
      toaster.create({ title: error.message, type: "error" });
    },
  });

  const deleteMutation = api.ssoConnection.delete.useMutation({
    onSuccess: () => {
      void connectionsQuery.refetch();
      setDeleteTarget(null);
      toaster.create({ title: "SSO connection deleted", type: "success" });
    },
    onError: (error) => {
      toaster.create({ title: error.message, type: "error" });
    },
  });

  const verifyMutation = api.ssoConnection.verifyDomain.useMutation({
    onSuccess: (result) => {
      void connectionsQuery.refetch();
      if (result.verified) {
        toaster.create({ title: "Domain verified", type: "success" });
      } else {
        toaster.create({
          title: "DNS record not found — check your TXT record and try again",
          type: "warning",
        });
      }
    },
    onError: (error) => {
      toaster.create({ title: error.message, type: "error" });
    },
  });

  const toggleMutation = api.ssoConnection.toggleEnforcement.useMutation({
    onSuccess: () => {
      void connectionsQuery.refetch();
    },
    onError: (error) => {
      toaster.create({ title: error.message, type: "error" });
    },
  });

  if (!organization) return <SettingsLayout />;

  // TODO: re-enable enterprise gate before merging
  if (!isEnterprise && false) {
    return (
      <SettingsLayout>
        <VStack gap={6} align="start" width="full">
          <Alert.Root status="info">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Enterprise Feature</Alert.Title>
              <Alert.Description>
                SSO configuration is available on Enterprise plans. Contact
                sales to upgrade.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
          <Box width="full">
            <ContactSalesBlock />
          </Box>
        </VStack>
      </SettingsLayout>
    );
  }

  const connections = connectionsQuery.data ?? [];

  const handleSave = (data: {
    domain: string;
    provider: string;
    clientId: string;
    clientSecret: string;
    issuerUrl?: string | null;
    tenantId?: string | null;
    samlEntityId?: string | null;
    samlSsoUrl?: string | null;
    samlCertificate?: string | null;
    attributeMapping?: Record<string, unknown> | null;
    roleMapping?: Record<string, unknown> | null;
    ssoEnforced?: boolean;
    jitProvisioning?: boolean;
    defaultOrgRole?: "ADMIN" | "MEMBER" | "EXTERNAL";
  }) => {
    if (editingConnection) {
      const { clientSecret, ...rest } = data;
      updateMutation.mutate({
        organizationId: organization.id,
        id: editingConnection.id,
        ...rest,
        ...(clientSecret ? { clientSecret } : {}),
      });
    } else {
      createMutation.mutate({
        organizationId: organization.id,
        ...data,
      });
    }
  };

  const handleDelete = (conn: SsoConnectionListItem) => {
    deleteMutation.mutate({
      organizationId: organization.id,
      id: conn.id,
    });
  };

  const filteredLogs = MOCK_SCIM_LOGS.filter((log) => {
    if (scimFilter === "success" && (log.status < 200 || log.status >= 300))
      return false;
    if (scimFilter === "4xx" && (log.status < 400 || log.status >= 500))
      return false;
    if (scimFilter === "5xx" && log.status < 500) return false;
    if (scimSearch && !log.path.toLowerCase().includes(scimSearch.toLowerCase()))
      return false;
    return true;
  });

  return (
    <SettingsLayout>
      <VStack gap={8} width="full" align="start">
        {/* ── Section 1: SSO Connections ─────────────────────────────── */}
        <VStack gap={4} width="full" align="start">
          <VStack align="start" gap={1}>
            <Heading as="h2">SSO Connections</Heading>
            <Text color="fg.muted" fontSize="sm">
              Configure single sign-on for your organization&apos;s email
              domains. Each domain can have one SSO provider.
            </Text>
          </VStack>

          <Separator />

          <Card.Root width="full" overflow="hidden">
            <Card.Body paddingY={0} paddingX={0}>
              <Table.Root variant="line" size="md" width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Domain</Table.ColumnHeader>
                    <Table.ColumnHeader>Provider</Table.ColumnHeader>
                    <Table.ColumnHeader>Status</Table.ColumnHeader>
                    <Table.ColumnHeader>Enforce</Table.ColumnHeader>
                    <Table.ColumnHeader width="48px" />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {connections.map((conn) => (
                    <Table.Row key={conn.id}>
                      <Table.Cell fontWeight="medium" fontFamily="mono">
                        {conn.domain}
                      </Table.Cell>
                      <Table.Cell>{providerLabel(conn.provider)}</Table.Cell>
                      <Table.Cell>
                        <Badge
                          colorPalette={conn.verifiedAt ? "green" : "yellow"}
                          size="sm"
                        >
                          {conn.verifiedAt ? "Verified" : "Pending"}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Switch
                          checked={conn.ssoEnforced}
                          size="sm"
                          onCheckedChange={(e) => {
                            toggleMutation.mutate({
                              organizationId: organization.id,
                              id: conn.id,
                              ssoEnforced: e.checked,
                            });
                          }}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-label={`Actions for ${conn.domain}`}
                            >
                              <MoreVertical size={16} />
                            </Button>
                          </Menu.Trigger>
                          <Menu.Content>
                            <Menu.Item
                              value="edit"
                              onClick={() => {
                                setEditingConnection(conn);
                                setModalOpen(true);
                              }}
                            >
                              <Box
                                display="flex"
                                alignItems="center"
                                gap={2}
                              >
                                <Edit2 size={14} />
                                Edit
                              </Box>
                            </Menu.Item>
                            <Menu.Item
                              value="delete"
                              color="red.500"
                              onClick={() => setDeleteTarget(conn)}
                            >
                              <Box
                                display="flex"
                                alignItems="center"
                                gap={2}
                              >
                                <Trash2 size={14} />
                                Delete
                              </Box>
                            </Menu.Item>
                          </Menu.Content>
                        </Menu.Root>
                      </Table.Cell>
                    </Table.Row>
                  ))}

                  {connections.length === 0 && (
                    <Table.Row>
                      <Table.Cell colSpan={5}>
                        <VStack paddingY={6} gap={2}>
                          <Text color="fg.muted" fontSize="sm">
                            No SSO connections configured
                          </Text>
                          <Button
                            size="sm"
                            colorPalette="blue"
                            onClick={() => {
                              setEditingConnection(null);
                              setModalOpen(true);
                            }}
                          >
                            <Plus size={14} />
                            Add SSO Connection
                          </Button>
                        </VStack>
                      </Table.Cell>
                    </Table.Row>
                  )}

                  {connections.length > 0 && (
                    <Table.Row
                      cursor="pointer"
                      onClick={() => {
                        setEditingConnection(null);
                        setModalOpen(true);
                      }}
                      _hover={{ bg: "bg.muted" }}
                      color="fg.muted"
                    >
                      <Table.Cell colSpan={5}>
                        <HStack gap={2}>
                          <Plus size={14} />
                          <Text fontSize="sm">Add SSO Connection</Text>
                        </HStack>
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Root>
            </Card.Body>
          </Card.Root>
        </VStack>

        {/* ── Section 2: SCIM Provisioning ───────────────────────────── */}
        <VStack gap={4} width="full" align="start">
          <VStack align="start" gap={1}>
            <Heading as="h2" size="lg">
              SCIM Provisioning
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Manage user and group provisioning from your identity provider.
            </Text>
          </VStack>

          <Separator />

          <Button asChild variant="outline" size="sm">
            <a href="/settings/scim">
              Manage SCIM Tokens
              <ExternalLink size={14} />
            </a>
          </Button>

          {/* SCIM Logs */}
          <VStack align="start" gap={3} width="full">
            <Text fontSize="sm" fontWeight="semibold">
              SCIM Request Logs
            </Text>

            <HStack gap={3} width="full">
              <HStack gap={1}>
                {(
                  [
                    ["all", "All"],
                    ["success", "2xx"],
                    ["4xx", "4xx"],
                    ["5xx", "5xx"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    size="xs"
                    variant={scimFilter === value ? "solid" : "outline"}
                    onClick={() => setScimFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
              </HStack>
              <HStack flex={1}>
                <Search size={14} />
                <Input
                  size="sm"
                  placeholder="Search by path..."
                  value={scimSearch}
                  onChange={(e) => setScimSearch(e.target.value)}
                />
              </HStack>
            </HStack>

            <Card.Root width="full" overflow="hidden">
              <Card.Body paddingY={0} paddingX={0}>
                <Table.Root variant="line" size="sm" width="full">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Time</Table.ColumnHeader>
                      <Table.ColumnHeader width="80px">
                        Method
                      </Table.ColumnHeader>
                      <Table.ColumnHeader>Path</Table.ColumnHeader>
                      <Table.ColumnHeader width="80px">
                        Status
                      </Table.ColumnHeader>
                      <Table.ColumnHeader width="80px" textAlign="right">
                        Duration
                      </Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {filteredLogs.map((log) => (
                      <Table.Row key={log.id} _hover={{ bg: "bg.muted" }}>
                        <Table.Cell>
                          <Text fontSize="xs" color="fg.muted">
                            {log.time}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge size="sm" variant="outline">
                            {log.method}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell fontFamily="mono" fontSize="xs">
                          {log.path}
                        </Table.Cell>
                        <Table.Cell>
                          <Badge
                            colorPalette={statusColor(log.status)}
                            size="sm"
                          >
                            {log.status}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell textAlign="right">
                          <Text fontSize="xs" color="fg.muted">
                            {log.duration}ms
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                    {filteredLogs.length === 0 && (
                      <Table.Row>
                        <Table.Cell colSpan={5}>
                          <Text
                            fontSize="sm"
                            color="fg.muted"
                            textAlign="center"
                            paddingY={4}
                          >
                            No SCIM requests match the current filters.
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table.Root>
              </Card.Body>
            </Card.Root>
          </VStack>
        </VStack>
      </VStack>

      {/* SSO Connection Modal */}
      <SsoConnectionModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingConnection(null);
        }}
        onSave={handleSave}
        onVerify={
          editingConnection
            ? () =>
                verifyMutation.mutate({
                  organizationId: organization.id,
                  id: editingConnection.id,
                })
            : undefined
        }
        editingConnection={editingConnection}
        saving={createMutation.isPending || updateMutation.isPending}
        verifying={verifyMutation.isPending}
      />

      {/* Delete Confirmation */}
      <Dialog.Root
        open={!!deleteTarget}
        onOpenChange={(e) => {
          if (!e.open) setDeleteTarget(null);
        }}
      >
        <Dialog.Content bg="bg" maxWidth="440px">
          <Dialog.Header>
            <Dialog.Title>Delete SSO connection</Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <Text fontSize="sm">
              Delete the SSO connection for{" "}
              <strong>{deleteTarget?.domain}</strong>? Users on this domain will
              be able to sign in with any enabled method again.
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              colorPalette="red"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:manage", {
  layoutComponent: SettingsLayout,
})(SsoSettings);
