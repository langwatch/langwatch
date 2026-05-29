import {
  Badge,
  Box,
  Button,
  Collapsible,
  HStack,
  Input,
  NativeSelect,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";

export interface SsoConnection {
  id: string;
  domain: string;
  provider: string;
  status: "pending" | "verified" | "active";
  ssoEnforced: boolean;
  jitProvisioning: boolean;
  defaultRole: string;
  verificationToken: string;
  clientId: string;
  issuerUrl: string;
  tenantId: string;
  attributeMapping: {
    email: string;
    name: string;
    groups: string;
    role: string;
  };
  roleMapping: {
    defaultRole: string;
    useRoleAttribute: boolean;
    groupMappings: Array<{ group: string; role: string }>;
  };
}

const PROVIDERS = [
  { value: "okta", label: "Okta" },
  { value: "azure-ad", label: "Azure AD / Entra ID" },
  { value: "google", label: "Google Workspace" },
  { value: "custom-oidc", label: "Custom OIDC" },
  { value: "custom-saml", label: "Custom SAML" },
];

function CopyButton({ value }: { value: string }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        toaster.create({ title: "Copied to clipboard", type: "success" });
      }}
    >
      <Clipboard size={14} />
    </Button>
  );
}

function AdvancedSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Collapsible.Trigger asChild>
        <Button variant="ghost" size="sm" width="full" justifyContent="start">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Text fontSize="sm" fontWeight="medium">
            {title}
          </Text>
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Box paddingLeft={6} paddingY={3}>
          {children}
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

const DEFAULT_CONNECTION: SsoConnection = {
  id: "",
  domain: "",
  provider: "okta",
  status: "pending",
  ssoEnforced: false,
  jitProvisioning: false,
  defaultRole: "MEMBER",
  verificationToken: crypto.randomUUID(),
  clientId: "",
  issuerUrl: "",
  tenantId: "",
  attributeMapping: { email: "email", name: "name", groups: "groups", role: "role" },
  roleMapping: {
    defaultRole: "MEMBER",
    useRoleAttribute: false,
    groupMappings: [],
  },
};

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (connection: SsoConnection) => void;
  editingConnection?: SsoConnection | null;
}

export function SsoConnectionModal({
  open,
  onClose,
  onSave,
  editingConnection,
}: Props) {
  const [conn, setConn] = useState<SsoConnection>(
    editingConnection ?? { ...DEFAULT_CONNECTION, verificationToken: crypto.randomUUID() },
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isEditing = !!editingConnection;

  const update = <K extends keyof SsoConnection>(
    key: K,
    value: SsoConnection[K],
  ) => setConn((c) => ({ ...c, [key]: value }));

  const callbackUrl =
    typeof window !== "undefined" && conn.domain
      ? `${window.location.origin}/api/auth/sso/${conn.domain}`
      : "";

  const handleSave = () => {
    if (!conn.domain || !conn.clientId) {
      toaster.create({
        title: "Please fill in all required fields",
        type: "error",
      });
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    onSave({
      ...conn,
      id: conn.id || crypto.randomUUID(),
      status: "active",
    });
    setConfirmOpen(false);
    onClose();
  };

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(e) => {
          if (!e.open) onClose();
        }}
      >
        <Dialog.Content bg="bg" maxWidth="720px">
          <Dialog.Header>
            <Dialog.Title>
              {isEditing ? "Edit SSO Connection" : "Add SSO Connection"}
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <VStack gap={5} align="stretch">
              {/* Domain */}
              <VStack align="start" gap={1}>
                <Text fontSize="sm" fontWeight="medium">
                  Domain *
                </Text>
                <Input
                  placeholder="acme.com"
                  value={conn.domain}
                  disabled={isEditing}
                  onChange={(e) => update("domain", e.target.value)}
                />
              </VStack>

              {/* Domain Verification */}
              {conn.domain && (
                <Box
                  borderWidth="1px"
                  borderColor="border.muted"
                  borderRadius="md"
                  padding={4}
                >
                  <VStack align="start" gap={3}>
                    <HStack>
                      <Text fontSize="sm" fontWeight="medium">
                        Domain Verification
                      </Text>
                      <Badge
                        colorPalette={
                          conn.status === "verified" || conn.status === "active"
                            ? "green"
                            : "yellow"
                        }
                        size="sm"
                      >
                        {conn.status === "verified" || conn.status === "active"
                          ? "Verified"
                          : "Pending"}
                      </Badge>
                    </HStack>
                    <Text fontSize="xs" color="fg.muted">
                      Add the following TXT record to your DNS provider:
                    </Text>
                    <Box
                      width="full"
                      bg="bg.subtle"
                      borderRadius="sm"
                      padding={3}
                    >
                      <VStack align="start" gap={2}>
                        <HStack width="full" justify="space-between">
                          <VStack align="start" gap={0}>
                            <Text fontSize="xs" color="fg.muted">
                              Host
                            </Text>
                            <Text fontSize="sm" fontFamily="mono">
                              _langwatch-verification
                            </Text>
                          </VStack>
                          <CopyButton value="_langwatch-verification" />
                        </HStack>
                        <HStack width="full" justify="space-between">
                          <VStack align="start" gap={0}>
                            <Text fontSize="xs" color="fg.muted">
                              Value
                            </Text>
                            <Text fontSize="sm" fontFamily="mono">
                              langwatch-verify={conn.verificationToken}
                            </Text>
                          </VStack>
                          <CopyButton
                            value={`langwatch-verify=${conn.verificationToken}`}
                          />
                        </HStack>
                      </VStack>
                    </Box>
                    <Button size="sm" variant="outline">
                      Verify Domain
                    </Button>
                  </VStack>
                </Box>
              )}

              {/* Provider */}
              <VStack align="start" gap={1}>
                <Text fontSize="sm" fontWeight="medium">
                  Provider *
                </Text>
                <NativeSelect.Root size="sm" width="full">
                  <NativeSelect.Field
                    value={conn.provider}
                    onChange={(e) => update("provider", e.target.value)}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </VStack>

              {/* Callback URL */}
              {conn.domain && (
                <Box bg="bg.subtle" borderRadius="sm" padding={3}>
                  <HStack justify="space-between">
                    <VStack align="start" gap={0}>
                      <Text fontSize="xs" color="fg.muted">
                        Callback URL — add this as redirect URI in your IdP
                      </Text>
                      <Text fontSize="sm" fontFamily="mono">
                        {callbackUrl}
                      </Text>
                    </VStack>
                    <CopyButton value={callbackUrl} />
                  </HStack>
                </Box>
              )}

              {/* Provider-specific fields */}
              <VStack align="start" gap={3}>
                <VStack align="start" gap={1} width="full">
                  <Text fontSize="sm" fontWeight="medium">
                    Client ID *
                  </Text>
                  <Input
                    placeholder="your-client-id"
                    value={conn.clientId}
                    onChange={(e) => update("clientId", e.target.value)}
                  />
                </VStack>

                <VStack align="start" gap={1} width="full">
                  <Text fontSize="sm" fontWeight="medium">
                    Client Secret *
                  </Text>
                  <Input
                    type="password"
                    placeholder="your-client-secret"
                  />
                </VStack>

                {(conn.provider === "okta" ||
                  conn.provider === "custom-oidc") && (
                  <VStack align="start" gap={1} width="full">
                    <Text fontSize="sm" fontWeight="medium">
                      Issuer URL *
                    </Text>
                    <Input
                      placeholder={
                        conn.provider === "okta"
                          ? "https://your-org.okta.com"
                          : "https://your-idp.example.com"
                      }
                      value={conn.issuerUrl}
                      onChange={(e) => update("issuerUrl", e.target.value)}
                    />
                  </VStack>
                )}

                {conn.provider === "azure-ad" && (
                  <VStack align="start" gap={1} width="full">
                    <Text fontSize="sm" fontWeight="medium">
                      Tenant ID *
                    </Text>
                    <Input
                      placeholder="your-tenant-id"
                      value={conn.tenantId}
                      onChange={(e) => update("tenantId", e.target.value)}
                    />
                  </VStack>
                )}

                {conn.provider === "custom-saml" && (
                  <>
                    <VStack align="start" gap={1} width="full">
                      <Text fontSize="sm" fontWeight="medium">
                        SAML Entity ID *
                      </Text>
                      <Input placeholder="https://idp.example.com/metadata" />
                    </VStack>
                    <VStack align="start" gap={1} width="full">
                      <Text fontSize="sm" fontWeight="medium">
                        SSO URL *
                      </Text>
                      <Input placeholder="https://idp.example.com/sso" />
                    </VStack>
                    <VStack align="start" gap={1} width="full">
                      <Text fontSize="sm" fontWeight="medium">
                        X.509 Certificate *
                      </Text>
                      <Textarea
                        placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                        rows={4}
                      />
                    </VStack>
                  </>
                )}
              </VStack>

              {/* Enforcement & Provisioning */}
              <VStack
                align="start"
                gap={3}
                borderTopWidth="1px"
                borderColor="border.muted"
                paddingTop={4}
              >
                <Text fontSize="sm" fontWeight="semibold">
                  Enforcement & Provisioning
                </Text>
                <HStack justify="space-between" width="full">
                  <VStack align="start" gap={0}>
                    <Text fontSize="sm">Enforce SSO</Text>
                    <Text fontSize="xs" color="fg.muted">
                      Users with this domain must use SSO. Password and social
                      login will be blocked.
                    </Text>
                  </VStack>
                  <Switch
                    checked={conn.ssoEnforced}
                    onCheckedChange={(e) => update("ssoEnforced", e.checked)}
                  />
                </HStack>
                <HStack justify="space-between" width="full">
                  <VStack align="start" gap={0}>
                    <Text fontSize="sm">Enable JIT provisioning</Text>
                    <Text fontSize="xs" color="fg.muted">
                      Automatically create accounts for first-time SSO users.
                    </Text>
                  </VStack>
                  <Switch
                    checked={conn.jitProvisioning}
                    onCheckedChange={(e) =>
                      update("jitProvisioning", e.checked)
                    }
                  />
                </HStack>
                <VStack align="start" gap={1} width="200px">
                  <Text fontSize="sm">Default role</Text>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field
                      value={conn.defaultRole}
                      onChange={(e) => update("defaultRole", e.target.value)}
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="MEMBER">Member</option>
                      <option value="VIEWER">Viewer</option>
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </VStack>
              </VStack>

              {/* Advanced: Attribute Mapping */}
              <AdvancedSection title="Attribute Mapping">
                <VStack gap={3} align="stretch">
                  <Text fontSize="xs" color="fg.muted">
                    Map IdP claim names to LangWatch user fields. Defaults work
                    for most providers.
                  </Text>
                  {(
                    [
                      ["email", "Email claim"],
                      ["name", "Name claim"],
                      ["groups", "Groups claim"],
                      ["role", "Role claim"],
                    ] as const
                  ).map(([key, label]) => (
                    <HStack key={key}>
                      <Text fontSize="sm" width="120px" flexShrink={0}>
                        {label}
                      </Text>
                      <Input
                        size="sm"
                        value={conn.attributeMapping[key]}
                        onChange={(e) =>
                          setConn((c) => ({
                            ...c,
                            attributeMapping: {
                              ...c.attributeMapping,
                              [key]: e.target.value,
                            },
                          }))
                        }
                      />
                    </HStack>
                  ))}
                </VStack>
              </AdvancedSection>

              {/* Advanced: Role Mapping */}
              <AdvancedSection title="Role Mapping">
                <VStack gap={3} align="stretch">
                  <Text fontSize="xs" color="fg.muted">
                    Map IdP groups or role attribute to LangWatch roles. If
                    multiple groups match, the highest privilege wins.
                  </Text>
                  <HStack>
                    <Text fontSize="sm" width="140px" flexShrink={0}>
                      Default role
                    </Text>
                    <NativeSelect.Root size="sm" width="160px">
                      <NativeSelect.Field
                        value={conn.roleMapping.defaultRole}
                        onChange={(e) =>
                          setConn((c) => ({
                            ...c,
                            roleMapping: {
                              ...c.roleMapping,
                              defaultRole: e.target.value,
                            },
                          }))
                        }
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="MEMBER">Member</option>
                        <option value="VIEWER">Viewer</option>
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </HStack>
                  <Switch
                    checked={conn.roleMapping.useRoleAttribute}
                    onCheckedChange={(e) =>
                      setConn((c) => ({
                        ...c,
                        roleMapping: {
                          ...c.roleMapping,
                          useRoleAttribute: e.checked,
                        },
                      }))
                    }
                  >
                    <Text fontSize="sm">
                      Use role attribute directly from IdP
                    </Text>
                  </Switch>

                  {!conn.roleMapping.useRoleAttribute && (
                    <VStack gap={2} align="stretch">
                      <Text fontSize="sm" fontWeight="medium">
                        Group to Role Mappings
                      </Text>
                      {conn.roleMapping.groupMappings.map((mapping, i) => (
                        <HStack key={i}>
                          <Input
                            size="sm"
                            placeholder="IdP Group Name"
                            value={mapping.group}
                            onChange={(e) =>
                              setConn((c) => {
                                const mappings = [
                                  ...c.roleMapping.groupMappings,
                                ];
                                mappings[i] = {
                                  ...mappings[i]!,
                                  group: e.target.value,
                                };
                                return {
                                  ...c,
                                  roleMapping: {
                                    ...c.roleMapping,
                                    groupMappings: mappings,
                                  },
                                };
                              })
                            }
                          />
                          <NativeSelect.Root size="sm" width="140px">
                            <NativeSelect.Field
                              value={mapping.role}
                              onChange={(e) =>
                                setConn((c) => {
                                  const mappings = [
                                    ...c.roleMapping.groupMappings,
                                  ];
                                  mappings[i] = {
                                    ...mappings[i]!,
                                    role: e.target.value,
                                  };
                                  return {
                                    ...c,
                                    roleMapping: {
                                      ...c.roleMapping,
                                      groupMappings: mappings,
                                    },
                                  };
                                })
                              }
                            >
                              <option value="ADMIN">Admin</option>
                              <option value="MEMBER">Member</option>
                              <option value="VIEWER">Viewer</option>
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                          </NativeSelect.Root>
                          <Button
                            variant="ghost"
                            size="xs"
                            colorPalette="red"
                            onClick={() =>
                              setConn((c) => ({
                                ...c,
                                roleMapping: {
                                  ...c.roleMapping,
                                  groupMappings:
                                    c.roleMapping.groupMappings.filter(
                                      (_, j) => j !== i,
                                    ),
                                },
                              }))
                            }
                          >
                            <Trash2 size={14} />
                          </Button>
                        </HStack>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setConn((c) => ({
                            ...c,
                            roleMapping: {
                              ...c.roleMapping,
                              groupMappings: [
                                ...c.roleMapping.groupMappings,
                                { group: "", role: "MEMBER" },
                              ],
                            },
                          }))
                        }
                      >
                        <Plus size={14} />
                        <Text fontSize="sm">Add Group Mapping</Text>
                      </Button>
                    </VStack>
                  )}
                </VStack>
              </AdvancedSection>
            </VStack>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button colorPalette="blue" onClick={handleSave}>
              Save
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>

      {/* Confirmation Dialog */}
      <Dialog.Root
        open={confirmOpen}
        onOpenChange={(e) => {
          if (!e.open) setConfirmOpen(false);
        }}
      >
        <Dialog.Content bg="bg" maxWidth="480px">
          <Dialog.Header>
            <Dialog.Title>
              Activate SSO for @{conn.domain}?
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <Text fontSize="sm">
              Every user with an <strong>@{conn.domain}</strong> email will be
              redirected to your identity provider on sign-in. Password and
              social login will be blocked for this domain.
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button colorPalette="blue" onClick={handleConfirm}>
              Activate SSO
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
