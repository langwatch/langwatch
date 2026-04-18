import {
  Badge,
  Box,
  Button,
  Card,
  createListCollection,
  Heading,
  HStack,
  IconButton,
  Input,
  Spacer,
  Tabs,
  Table,
  Text,
  Textarea,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { AlertTriangle, Copy, Eye, EyeOff, Key, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import SettingsLayout from "../../components/SettingsLayout";
import { Dialog } from "../../components/ui/dialog";
import { Drawer } from "../../components/ui/drawer";
import { Select } from "../../components/ui/select";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { api } from "../../utils/api";

const EXPIRATION_OPTIONS = [
  { label: "No expiration", value: "" },
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
  { label: "Custom...", value: "custom" },
];

const expirationCollection = createListCollection({ items: EXPIRATION_OPTIONS });

/**
 * A preformatted code block with a badge header and a single copy button.
 * Optionally supports masking + an eye toggle for secret values.
 *
 * - `display`        — what the user sees (may contain masked tokens)
 * - `revealedDisplay` — if set, enables the eye toggle and shows this on reveal
 * - `copyValue`      — what actually goes to the clipboard (unmasked)
 */
function CodeBlock({
  label,
  display,
  copyValue,
  revealedDisplay,
  copyToastTitle,
  ariaLabel,
}: {
  label?: string;
  display: string;
  copyValue: string;
  revealedDisplay?: string;
  copyToastTitle?: string;
  ariaLabel?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const canReveal = Boolean(revealedDisplay);
  const shown = revealed && revealedDisplay ? revealedDisplay : display;

  const handleCopy = () => {
    if (!navigator.clipboard) {
      toaster.create({
        title: "Clipboard not available — copy manually",
        type: "error",
        duration: 3000,
        meta: { closable: true },
      });
      return;
    }
    void navigator.clipboard.writeText(copyValue).then(() => {
      toaster.create({
        title: copyToastTitle ?? "Copied to clipboard",
        type: "success",
        duration: 2000,
        meta: { closable: true },
      });
    });
  };

  return (
    <Box
      position="relative"
      width="full"
      background="bg.muted"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
    >
      <HStack
        paddingX={3}
        paddingY={1.5}
        borderBottomWidth="1px"
        borderColor="border"
        background="bg.subtle"
      >
        {label && (
          <Badge size="sm" variant="subtle" fontFamily="monospace">
            {label}
          </Badge>
        )}
        <Spacer />
        {canReveal && (
          <IconButton
            aria-label={revealed ? "Hide secret values" : "Show secret values"}
            size="xs"
            variant="ghost"
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconButton>
        )}
        <IconButton
          aria-label={ariaLabel ?? "Copy"}
          size="xs"
          variant="ghost"
          onClick={handleCopy}
        >
          <Copy size={14} />
        </IconButton>
      </HStack>
      <Box
        as="pre"
        fontFamily="monospace"
        fontSize="xs"
        padding={3}
        overflow="auto"
        whiteSpace="pre"
        margin={0}
      >
        {shown}
      </Box>
    </Box>
  );
}

/** Mask the middle of a secret string for display. */
function maskSecret(v: string): string {
  if (v.length <= 8) return "********";
  return `${v.slice(0, 4)}${"*".repeat(Math.min(v.length - 8, 32))}${v.slice(-4)}`;
}

/** Build a `.env` snippet from key/value entries. */
function formatEnvLines(
  entries: Array<{ key: string; value: string; mask?: boolean }>,
): string {
  return entries
    .map(({ key, value, mask }) => `${key}="${mask ? maskSecret(value) : value}"`)
    .join("\n");
}

function roleSummary(
  bindings: Array<{
    role: string;
    scopeType: string;
    scopeId: string;
  }>,
): string {
  if (bindings.length === 0) return "No permissions";
  const first = bindings[0]!;
  const scope =
    first.scopeType === "ORGANIZATION"
      ? "Org-wide"
      : first.scopeType === "TEAM"
        ? "Team"
        : "Project";
  const suffix = bindings.length > 1 ? ` +${bindings.length - 1} more` : "";
  return `${first.role} (${scope})${suffix}`;
}

export default function ApiKeysPage() {
  const { organization, project } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return (
    <SettingsLayout>
      <VStack gap={4} width="full" maxWidth="960px" align="stretch">
        <VStack gap={1} align="start">
          <Heading size="lg">API Keys</Heading>
          <Text fontSize="sm" color="fg.muted">
            Manage credentials used to authenticate with the LangWatch API.
          </Text>
        </VStack>
        <Tabs.Root variant="line" defaultValue="pats">
          <Tabs.List>
            <Tabs.Trigger
              value="pats"
              color="fg.muted"
              _selected={{ color: "fg", fontWeight: "semibold" }}
            >
              Personal Access Tokens
            </Tabs.Trigger>
            <Tabs.Trigger
              value="project"
              gap={2}
              color="fg.muted"
              _selected={{ color: "fg", fontWeight: "semibold" }}
            >
              Project API Key
              <Badge size="sm" colorPalette="yellow" variant="outline">
                Legacy
              </Badge>
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="pats" paddingTop={6}>
            <PersonalAccessTokensSection
              organizationId={organization.id}
              projectId={project?.id}
            />
          </Tabs.Content>
          <Tabs.Content value="project" paddingTop={6}>
            <ProjectApiKeySection />
          </Tabs.Content>
        </Tabs.Root>
      </VStack>
    </SettingsLayout>
  );
}

/**
 * Project-scoped legacy API key (`sk-lw-...`). One per project.
 * Lives next to the PAT list on the Settings → API Key page so users can
 * manage both personal and project credentials in one spot.
 */
function ProjectApiKeySection() {
  const { project } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();
  const apiKey = project?.apiKey ?? "";
  const endpoint = publicEnv.data?.BASE_HOST ?? "https://app.langwatch.ai";

  return (
    <VStack gap={4} width="full" align="stretch">
      <Text fontSize="sm" color="fg.muted">
        One shared key per project, used by the SDK and older integrations
        that send traces on behalf of the project rather than a user.
      </Text>
      <HStack
        align="start"
        gap={2}
        padding={3}
        borderWidth="1px"
        borderColor="orange.emphasized"
        background="orange.subtle"
        borderRadius="md"
      >
        <Box color="orange.fg" paddingTop={0.5}>
          <AlertTriangle size={16} />
        </Box>
        <Text fontSize="sm" color="fg">
          Prefer{" "}
          <Text as="span" fontWeight="600">
            Personal Access Tokens
          </Text>{" "}
          for new integrations — they&apos;re scoped to a user, honor your
          role bindings, and can be revoked individually. Project API keys
          remain available for backwards compatibility.
        </Text>
      </HStack>
      <CodeBlock
        label=".env"
        display={formatEnvLines([
          { key: "LANGWATCH_API_KEY", value: apiKey, mask: true },
          { key: "LANGWATCH_ENDPOINT", value: endpoint },
        ])}
        revealedDisplay={formatEnvLines([
          { key: "LANGWATCH_API_KEY", value: apiKey },
          { key: "LANGWATCH_ENDPOINT", value: endpoint },
        ])}
        copyValue={formatEnvLines([
          { key: "LANGWATCH_API_KEY", value: apiKey },
          { key: "LANGWATCH_ENDPOINT", value: endpoint },
        ])}
        copyToastTitle=".env copied to clipboard"
        ariaLabel="Copy .env contents"
      />
    </VStack>
  );
}

function PersonalAccessTokensSection({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId?: string;
}) {
  useRequiredSession();
  const publicEnv = usePublicEnv();
  const endpoint = publicEnv.data?.BASE_HOST ?? "https://app.langwatch.ai";
  const pats = api.personalAccessToken.list.useQuery({ organizationId });
  const myBindings = api.personalAccessToken.myBindings.useQuery({
    organizationId,
  });
  const createMutation = api.personalAccessToken.create.useMutation();
  const revokeMutation = api.personalAccessToken.revoke.useMutation();
  const queryClient = api.useContext();

  const {
    open: isCreateOpen,
    onOpen: onCreateOpen,
    onClose: onCreateClose,
  } = useDisclosure();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expirationPreset, setExpirationPreset] = useState("");
  const [customDate, setCustomDate] = useState("");
  const minCustomDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [patToRevoke, setPatToRevoke] = useState<string | null>(null);

  const handleCreate = () => {
    let expiresAt: Date | undefined;
    if (expirationPreset === "custom" && customDate) {
      expiresAt = new Date(customDate);
    } else if (expirationPreset && expirationPreset !== "custom") {
      const days = parseInt(expirationPreset, 10);
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    // Mirror the caller's own RoleBindings onto the PAT. A future
    // "Advanced" UI will let users narrow this down per-scope/role.
    const bindings = (myBindings.data ?? []).map((b) => ({
      role: b.role,
      customRoleId: b.customRoleId,
      scopeType: b.scopeType,
      scopeId: b.scopeId,
    }));

    if (bindings.length === 0) {
      toaster.create({
        title: "No permissions to grant",
        description:
          "You have no role bindings in this organization, so there is nothing to grant to a token.",
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
      return;
    }

    createMutation.mutate(
      {
        organizationId,
        name,
        description: description.trim() ? description.trim() : undefined,
        expiresAt,
        bindings,
      },
      {
        onSuccess: (result) => {
          setNewToken(result.token);
          setName("");
          setDescription("");
          setExpirationPreset("");
          setCustomDate("");
          void queryClient.personalAccessToken.list.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to create token",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const handleRevoke = (patId: string) => {
    revokeMutation.mutate(
      { organizationId, patId },
      {
        onSuccess: () => {
          setPatToRevoke(null);
          toaster.create({
            title: "Token revoked",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          void queryClient.personalAccessToken.list.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to revoke token",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const activePats = useMemo(
    () => pats.data?.filter((p) => !p.revokedAt) ?? [],
    [pats.data],
  );

  return (
    <>
      <VStack gap={4} width="full" align="start">
        <HStack width="full">
          <Text fontSize="sm" color="fg.muted">
            User-scoped tokens that authenticate API requests on your behalf.
            Shown once at creation — copy it immediately.
          </Text>
          <Spacer />
          <Button size="sm" onClick={onCreateOpen}>
            <Plus size={16} />
            Create Token
          </Button>
        </HStack>

        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Permissions</Table.ColumnHeader>
                  <Table.ColumnHeader>Expires</Table.ColumnHeader>
                  <Table.ColumnHeader>Created</Table.ColumnHeader>
                  <Table.ColumnHeader>Last Used</Table.ColumnHeader>
                  <Table.ColumnHeader width="80px"></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {activePats.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={6}>
                      <Text color="fg.muted" textAlign="center" paddingY={4}>
                        No active tokens. Create one to get started.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                )}
                {activePats.map((pat) => (
                  <Table.Row key={pat.id}>
                    <Table.Cell>
                      <HStack align="start">
                        <Box paddingTop={1}>
                          <Key size={14} />
                        </Box>
                        <VStack align="start" gap={0}>
                          <Text>{pat.name}</Text>
                          {pat.description && (
                            <Text fontSize="xs" color="fg.muted">
                              {pat.description}
                            </Text>
                          )}
                        </VStack>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" color="fg.muted">
                        {roleSummary(pat.roleBindings)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {pat.expiresAt ? (
                        new Date(pat.expiresAt) < new Date() ? (
                          <Badge size="sm" colorPalette="red">Expired</Badge>
                        ) : (
                          new Date(pat.expiresAt).toLocaleDateString()
                        )
                      ) : (
                        <Badge size="sm" colorPalette="gray">Never</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {new Date(pat.createdAt).toLocaleDateString()}
                    </Table.Cell>
                    <Table.Cell>
                      {pat.lastUsedAt ? (
                        new Date(pat.lastUsedAt).toLocaleDateString()
                      ) : (
                        <Badge size="sm" colorPalette="gray">
                          Never
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        aria-label={`Revoke token ${pat.name}`}
                        onClick={() => setPatToRevoke(pat.id)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>
      </VStack>

      {/* Create Token Drawer */}
      <Drawer.Root
        placement="end"
        size="md"
        open={isCreateOpen && !newToken}
        onOpenChange={({ open }) => {
          if (!open) {
            onCreateClose();
            setName("");
            setDescription("");
            setExpirationPreset("");
            setCustomDate("");
          }
        }}
      >
        <Drawer.Content>
          <Drawer.Header>
            <Heading size="md">Create Personal Access Token</Heading>
            <Drawer.CloseTrigger />
          </Drawer.Header>
          <Drawer.Body>
            <VStack gap={5} align="start">
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Token Name
                </Text>
                <Input
                  placeholder="e.g., CI Pipeline, Local Dev"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </VStack>
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Description{" "}
                  <Text as="span" color="fg.muted" fontWeight="400">
                    (optional)
                  </Text>
                </Text>
                <Textarea
                  placeholder="What is this token used for? (e.g., CI runs traces for the staging project)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={3}
                  resize="vertical"
                />
              </VStack>
              <VStack gap={2} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Access
                </Text>
                <Box
                  width="full"
                  padding={3}
                  borderWidth="1px"
                  borderColor="border"
                  borderRadius="md"
                  background="bg.muted"
                >
                  <Text fontSize="sm">
                    This token will inherit{" "}
                    <Text as="span" fontWeight="600">
                      your current permissions
                    </Text>{" "}
                    in this organization:
                  </Text>
                  {myBindings.isLoading ? (
                    <Text fontSize="xs" color="fg.muted" marginTop={2}>
                      Loading your role bindings…
                    </Text>
                  ) : (myBindings.data?.length ?? 0) === 0 ? (
                    <Text fontSize="xs" color="fg.muted" marginTop={2}>
                      You have no role bindings in this organization yet.
                    </Text>
                  ) : (
                    <VStack align="stretch" gap={1} marginTop={2}>
                      {myBindings.data!.map((b) => {
                        const scopeLabel =
                          b.scopeType === "ORGANIZATION"
                            ? "Org-wide"
                            : b.scopeType === "TEAM"
                              ? `Team: ${b.scopeName ?? b.scopeId}`
                              : `Project: ${b.scopeName ?? b.scopeId}`;
                        const roleLabel =
                          b.role === "CUSTOM"
                            ? b.customRoleName ?? "Custom"
                            : b.role;
                        return (
                          <HStack key={b.id} gap={2} fontSize="xs">
                            <Badge size="sm" variant="subtle">
                              {roleLabel}
                            </Badge>
                            <Text color="fg.muted">{scopeLabel}</Text>
                          </HStack>
                        );
                      })}
                    </VStack>
                  )}
                  <Text fontSize="xs" color="fg.muted" marginTop={3}>
                    Your access acts as a ceiling — if your role is later
                    reduced, the token loses those permissions automatically.
                  </Text>
                </Box>

              </VStack>
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Expiration
                </Text>
                <Select.Root
                  collection={expirationCollection}
                  value={[expirationPreset]}
                  onValueChange={(details) => {
                    const val = details.value[0] ?? "";
                    setExpirationPreset(val);
                    if (val !== "custom") setCustomDate("");
                  }}
                >
                  <Select.Trigger width="full" background="bg">
                    <Select.ValueText placeholder="No expiration" />
                  </Select.Trigger>
                  <Select.Content width="300px" paddingY={2}>
                    {EXPIRATION_OPTIONS.map((option) => (
                      <Select.Item key={option.value} item={option}>
                        {option.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                {expirationPreset === "custom" && (
                  <Input
                    type="date"
                    value={customDate}
                    min={minCustomDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                  />
                )}
              </VStack>
            </VStack>
          </Drawer.Body>
          <Drawer.Footer>
            <HStack width="full" justify="end" gap={2}>
              <Button variant="outline" onClick={onCreateClose}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  createMutation.isLoading ||
                  !name.trim() ||
                  myBindings.isLoading ||
                  (myBindings.data?.length ?? 0) === 0
                }
              >
                Create Token
              </Button>
            </HStack>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>

      {/* Show Token Dialog */}
      <Dialog.Root
        size="xl"
        open={!!newToken}
        onOpenChange={({ open }) => {
          if (!open) {
            setNewToken(null);
            onCreateClose();
          }
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Token Created</Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={5} align="stretch">
              <Text color="orange.500" fontWeight="600">
                Copy this token now. You won&apos;t be able to see it again.
              </Text>
              {newToken && (
                <CodeBlock
                  label=".env"
                  display={formatEnvLines([
                    { key: "LANGWATCH_API_KEY", value: newToken, mask: true },
                    {
                      key: "LANGWATCH_PROJECT_ID",
                      value: projectId ?? "<your-project-id>",
                    },
                    { key: "LANGWATCH_ENDPOINT", value: endpoint },
                  ])}
                  revealedDisplay={formatEnvLines([
                    { key: "LANGWATCH_API_KEY", value: newToken },
                    {
                      key: "LANGWATCH_PROJECT_ID",
                      value: projectId ?? "<your-project-id>",
                    },
                    { key: "LANGWATCH_ENDPOINT", value: endpoint },
                  ])}
                  copyValue={formatEnvLines([
                    { key: "LANGWATCH_API_KEY", value: newToken },
                    {
                      key: "LANGWATCH_PROJECT_ID",
                      value: projectId ?? "<your-project-id>",
                    },
                    { key: "LANGWATCH_ENDPOINT", value: endpoint },
                  ])}
                  copyToastTitle=".env copied to clipboard"
                  ariaLabel="Copy .env contents"
                />
              )}

              <VStack gap={2} align="stretch" width="full">
                <Text fontWeight="600" fontSize="sm">
                  How to use this token
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  Send the token on every request using one of the two options
                  below. Both carry the project context LangWatch needs to
                  route traces and enforce permissions.
                </Text>
              </VStack>

              <VStack gap={2} align="stretch" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Option 1 — Bearer token
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  Use the <code>Authorization</code> header plus{" "}
                  <code>X-Project-Id</code>:
                </Text>
                <CodeBlock
                  label="http"
                  display={`Authorization: Bearer ${
                    newToken ? maskSecret(newToken) : "pat-lw-..."
                  }\nX-Project-Id: ${projectId ?? "<your-project-id>"}`}
                  revealedDisplay={`Authorization: Bearer ${newToken ?? ""}\nX-Project-Id: ${
                    projectId ?? "<your-project-id>"
                  }`}
                  copyValue={`Authorization: Bearer ${newToken ?? ""}\nX-Project-Id: ${
                    projectId ?? "<your-project-id>"
                  }`}
                  copyToastTitle="Bearer headers copied"
                  ariaLabel="Copy Bearer headers"
                />
              </VStack>

              <VStack gap={2} align="stretch" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Option 2 — Basic Auth (SDK clients)
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  Encode the project ID and token as{" "}
                  <code>base64(projectId:token)</code>:
                </Text>
                <CodeBlock
                  label="http"
                  display={`Authorization: Basic base64(${
                    projectId ?? "<your-project-id>"
                  }:pat-lw-...)`}
                  revealedDisplay={
                    newToken && projectId
                      ? `Authorization: Basic ${btoa(
                          `${projectId}:${newToken}`,
                        )}`
                      : ""
                  }
                  copyValue={
                    newToken && projectId
                      ? `Authorization: Basic ${btoa(
                          `${projectId}:${newToken}`,
                        )}`
                      : ""
                  }
                  copyToastTitle="Basic Auth header copied"
                  ariaLabel="Copy Basic Auth header"
                />
              </VStack>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      {/* Revoke Confirmation Dialog */}
      <Dialog.Root
        size="lg"
        open={!!patToRevoke}
        onOpenChange={({ open }) => {
          if (!open) setPatToRevoke(null);
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              Revoke Token
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text>
                Are you sure you want to revoke this token? Any integration
                using it will stop working immediately.
              </Text>
              <HStack width="full" justify="end" gap={2}>
                <Button
                  variant="outline"
                  onClick={() => setPatToRevoke(null)}
                >
                  Cancel
                </Button>
                <Button
                  colorPalette="red"
                  onClick={() => patToRevoke && handleRevoke(patToRevoke)}
                  disabled={revokeMutation.isLoading}
                >
                  Revoke
                </Button>
              </HStack>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
