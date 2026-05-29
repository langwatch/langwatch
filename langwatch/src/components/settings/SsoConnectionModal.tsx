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
import { useEffect, useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import type { RouterOutputs } from "~/utils/api";

export type SsoConnectionListItem =
  RouterOutputs["ssoConnection"]["list"][number];

interface FormState {
  domain: string;
  provider: string;
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  tenantId: string;
  samlEntityId: string;
  samlSsoUrl: string;
  samlCertificate: string;
  ssoEnforced: boolean;
  jitProvisioning: boolean;
  defaultOrgRole: string;
  verificationToken: string;
  verifiedAt: Date | null;
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

function defaultFormState(): FormState {
  return {
    domain: "",
    provider: "okta",
    clientId: "",
    clientSecret: "",
    issuerUrl: "",
    tenantId: "",
    samlEntityId: "",
    samlSsoUrl: "",
    samlCertificate: "",
    ssoEnforced: false,
    jitProvisioning: false,
    defaultOrgRole: "MEMBER",
    verificationToken: "",
    verifiedAt: null,
    attributeMapping: { email: "email", name: "name", groups: "groups", role: "role" },
    roleMapping: {
      defaultRole: "MEMBER",
      useRoleAttribute: false,
      groupMappings: [],
    },
  };
}

function connectionToForm(conn: SsoConnectionListItem): FormState {
  const attrMap = (conn.attributeMapping ?? {}) as Record<string, string>;
  const roleMap = (conn.roleMapping ?? {}) as Record<string, unknown>;

  return {
    domain: conn.domain,
    provider: conn.provider,
    clientId: conn.clientId,
    clientSecret: "",
    issuerUrl: conn.issuerUrl ?? "",
    tenantId: conn.tenantId ?? "",
    samlEntityId: conn.samlEntityId ?? "",
    samlSsoUrl: conn.samlSsoUrl ?? "",
    samlCertificate: "",
    ssoEnforced: conn.ssoEnforced,
    jitProvisioning: conn.jitProvisioning,
    defaultOrgRole: conn.defaultOrgRole,
    verificationToken: conn.verificationToken,
    verifiedAt: conn.verifiedAt,
    attributeMapping: {
      email: attrMap.email ?? "email",
      name: attrMap.name ?? "name",
      groups: attrMap.groups ?? "groups",
      role: attrMap.role ?? "role",
    },
    roleMapping: {
      defaultRole: (roleMap.defaultRole as string) ?? "MEMBER",
      useRoleAttribute: (roleMap.useRoleAttribute as boolean) ?? false,
      groupMappings: (roleMap.groupMappings as Array<{ group: string; role: string }>) ?? [],
    },
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
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
  }) => void;
  editingConnection?: SsoConnectionListItem | null;
  saving?: boolean;
}

export function SsoConnectionModal({
  open,
  onClose,
  onSave,
  editingConnection,
  saving,
}: Props) {
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isEditing = !!editingConnection;

  useEffect(() => {
    if (open) {
      setForm(
        editingConnection
          ? connectionToForm(editingConnection)
          : defaultFormState(),
      );
      setConfirmOpen(false);
    }
  }, [open, editingConnection]);

  const update = <K extends keyof FormState>(
    key: K,
    value: FormState[K],
  ) => setForm((c) => ({ ...c, [key]: value }));

  const callbackUrl =
    typeof window !== "undefined" && form.domain
      ? `${window.location.origin}/api/auth/sso/${form.domain}`
      : "";

  const handleSave = () => {
    if (!form.domain || !form.clientId) {
      toaster.create({
        title: "Please fill in all required fields",
        type: "error",
      });
      return;
    }
    if (!isEditing && !form.clientSecret) {
      toaster.create({
        title: "Client secret is required",
        type: "error",
      });
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    onSave({
      domain: form.domain,
      provider: form.provider,
      clientId: form.clientId,
      clientSecret: form.clientSecret,
      issuerUrl: form.issuerUrl || null,
      tenantId: form.tenantId || null,
      samlEntityId: form.samlEntityId || null,
      samlSsoUrl: form.samlSsoUrl || null,
      samlCertificate: form.samlCertificate || null,
      attributeMapping: form.attributeMapping,
      roleMapping: form.roleMapping,
      ssoEnforced: form.ssoEnforced,
      jitProvisioning: form.jitProvisioning,
      defaultOrgRole: form.defaultOrgRole as "ADMIN" | "MEMBER" | "EXTERNAL",
    });
    setConfirmOpen(false);
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
                  value={form.domain}
                  disabled={isEditing}
                  onChange={(e) => update("domain", e.target.value)}
                />
              </VStack>

              {/* Domain Verification */}
              {form.domain && form.verificationToken && (
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
                        colorPalette={form.verifiedAt ? "green" : "yellow"}
                        size="sm"
                      >
                        {form.verifiedAt ? "Verified" : "Pending"}
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
                              langwatch-verify={form.verificationToken}
                            </Text>
                          </VStack>
                          <CopyButton
                            value={`langwatch-verify=${form.verificationToken}`}
                          />
                        </HStack>
                      </VStack>
                    </Box>
                    <Button size="sm" variant="outline" disabled>
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
                    value={form.provider}
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
              {form.domain && (
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
                    value={form.clientId}
                    onChange={(e) => update("clientId", e.target.value)}
                  />
                </VStack>

                <VStack align="start" gap={1} width="full">
                  <Text fontSize="sm" fontWeight="medium">
                    Client Secret {isEditing ? "(leave blank to keep)" : "*"}
                  </Text>
                  <Input
                    type="password"
                    placeholder={
                      isEditing
                        ? "Leave blank to keep existing secret"
                        : "your-client-secret"
                    }
                    value={form.clientSecret}
                    onChange={(e) => update("clientSecret", e.target.value)}
                  />
                </VStack>

                {(form.provider === "okta" ||
                  form.provider === "custom-oidc") && (
                  <VStack align="start" gap={1} width="full">
                    <Text fontSize="sm" fontWeight="medium">
                      Issuer URL *
                    </Text>
                    <Input
                      placeholder={
                        form.provider === "okta"
                          ? "https://your-org.okta.com"
                          : "https://your-idp.example.com"
                      }
                      value={form.issuerUrl}
                      onChange={(e) => update("issuerUrl", e.target.value)}
                    />
                  </VStack>
                )}

                {form.provider === "azure-ad" && (
                  <VStack align="start" gap={1} width="full">
                    <Text fontSize="sm" fontWeight="medium">
                      Tenant ID *
                    </Text>
                    <Input
                      placeholder="your-tenant-id"
                      value={form.tenantId}
                      onChange={(e) => update("tenantId", e.target.value)}
                    />
                  </VStack>
                )}

                {form.provider === "custom-saml" && (
                  <>
                    <VStack align="start" gap={1} width="full">
                      <Text fontSize="sm" fontWeight="medium">
                        SAML Entity ID *
                      </Text>
                      <Input
                        placeholder="https://idp.example.com/metadata"
                        value={form.samlEntityId}
                        onChange={(e) => update("samlEntityId", e.target.value)}
                      />
                    </VStack>
                    <VStack align="start" gap={1} width="full">
                      <Text fontSize="sm" fontWeight="medium">
                        SSO URL *
                      </Text>
                      <Input
                        placeholder="https://idp.example.com/sso"
                        value={form.samlSsoUrl}
                        onChange={(e) => update("samlSsoUrl", e.target.value)}
                      />
                    </VStack>
                    <VStack align="start" gap={1} width="full">
                      <Text fontSize="sm" fontWeight="medium">
                        X.509 Certificate *
                      </Text>
                      <Textarea
                        placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                        rows={4}
                        value={form.samlCertificate}
                        onChange={(e) =>
                          update("samlCertificate", e.target.value)
                        }
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
                    checked={form.ssoEnforced}
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
                    checked={form.jitProvisioning}
                    onCheckedChange={(e) =>
                      update("jitProvisioning", e.checked)
                    }
                  />
                </HStack>
                <VStack align="start" gap={1} width="200px">
                  <Text fontSize="sm">Default role</Text>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field
                      value={form.defaultOrgRole}
                      onChange={(e) => update("defaultOrgRole", e.target.value)}
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="MEMBER">Member</option>
                      <option value="EXTERNAL">External</option>
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
                        value={form.attributeMapping[key]}
                        onChange={(e) =>
                          setForm((c) => ({
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
                        value={form.roleMapping.defaultRole}
                        onChange={(e) =>
                          setForm((c) => ({
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
                        <option value="EXTERNAL">External</option>
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </HStack>
                  <Switch
                    checked={form.roleMapping.useRoleAttribute}
                    onCheckedChange={(e) =>
                      setForm((c) => ({
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

                  {!form.roleMapping.useRoleAttribute && (
                    <VStack gap={2} align="stretch">
                      <Text fontSize="sm" fontWeight="medium">
                        Group to Role Mappings
                      </Text>
                      {form.roleMapping.groupMappings.map((mapping, i) => (
                        <HStack key={i}>
                          <Input
                            size="sm"
                            placeholder="IdP Group Name"
                            value={mapping.group}
                            onChange={(e) =>
                              setForm((c) => {
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
                                setForm((c) => {
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
                              <option value="EXTERNAL">External</option>
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                          </NativeSelect.Root>
                          <Button
                            variant="ghost"
                            size="xs"
                            colorPalette="red"
                            onClick={() =>
                              setForm((c) => ({
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
                          setForm((c) => ({
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
            <Button
              colorPalette="blue"
              onClick={handleSave}
              loading={saving}
            >
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
              Activate SSO for @{form.domain}?
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <Text fontSize="sm">
              Every user with an <strong>@{form.domain}</strong> email will be
              redirected to your identity provider on sign-in. Password and
              social login will be blocked for this domain.
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleConfirm}
              loading={saving}
            >
              Activate SSO
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
