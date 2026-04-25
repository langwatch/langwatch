import {
  Box,
  Button,
  createListCollection,
  Heading,
  HStack,
  Input,
  SegmentGroup,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { Drawer } from "../../../components/ui/drawer";
import { Select } from "../../../components/ui/select";
import type { RouterOutputs } from "../../../utils/api";
import { api } from "../../../utils/api";
import {
  EXPIRATION_OPTIONS,
  expirationCollection,
  ROLE_LABELS,
  STANDARD_ROLES,
  type PermissionMode,
} from "./utils";

type MyBindingsData = RouterOutputs["apiKey"]["myBindings"];
type MyBindings = {
  data: MyBindingsData | undefined;
  isLoading: boolean;
};

type OrgProject = { id: string; name: string };

export type CreateApiKeyInput = {
  name: string;
  description: string;
  expiresAt: Date | undefined;
  permissionMode: PermissionMode;
  assignedToUserId?: string;
  bindings: Array<{
    role: string;
    customRoleId: string | null | undefined;
    scopeType: string;
    scopeId: string;
  }>;
};

export function CreateApiKeyDrawer({
  isOpen,
  isCreating,
  myBindings,
  orgProjects,
  organizationId,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  isCreating: boolean;
  myBindings: MyBindings;
  orgProjects: OrgProject[];
  organizationId: string;
  onClose: () => void;
  onCreate: (input: CreateApiKeyInput) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expirationPreset, setExpirationPreset] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("all");
  const [projectRoles, setProjectRoles] = useState<Record<string, string>>({});
  const [ownedBy, setOwnedBy] = useState<"you" | "service" | "other">("you");
  const [selectedUserId, setSelectedUserId] = useState("");

  // Fetch org members for the "Other user" picker (admin only)
  const orgMembers = api.apiKey.orgMembers.useQuery(
    { organizationId },
    { enabled: isOpen },
  );
  const isAdmin = (orgMembers.data?.length ?? 0) > 0;

  const minCustomDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const memberCollection = useMemo(() => {
    const items = (orgMembers.data ?? []).map((m) => ({
      label: m.name ?? m.email ?? m.id,
      value: m.id,
    }));
    return createListCollection({ items });
  }, [orgMembers.data]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setExpirationPreset("");
    setCustomDate("");
    setPermissionMode("all");
    setProjectRoles({});
    setOwnedBy("you");
    setSelectedUserId("");
  };

  useEffect(() => {
    if (isOpen) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /** Build the bindings array from the current permission mode and project role selections. */
  const buildBindings = () => {
    if (!myBindings.data) return [];

    if (permissionMode === "all") {
      // Mirror user's bindings 1:1
      return myBindings.data.map((b) => ({
        role: b.role,
        customRoleId: b.customRoleId,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      }));
    }

    if (permissionMode === "readonly") {
      // All bindings as VIEWER
      return myBindings.data.map((b) => ({
        role: "VIEWER" as const,
        customRoleId: null,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      }));
    }

    // Restricted: use per-project role selections (skip "NONE")
    return orgProjects
      .filter((p) => (projectRoles[p.id] ?? "NONE") !== "NONE")
      .map((p) => ({
        role: projectRoles[p.id] ?? "VIEWER",
        customRoleId: null,
        scopeType: "PROJECT" as const,
        scopeId: p.id,
      }));
  };

  const handleCreate = () => {
    let expiresAt: Date | undefined;
    if (expirationPreset === "custom" && customDate) {
      expiresAt = new Date(customDate);
    } else if (expirationPreset && expirationPreset !== "custom") {
      const days = parseInt(expirationPreset, 10);
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    const bindings = buildBindings();
    onCreate({
      name,
      description,
      expiresAt,
      permissionMode,
      assignedToUserId: ownedBy === "other" && selectedUserId ? selectedUserId : undefined,
      bindings,
    });
    resetForm();
  };

  const canCreate =
    name.trim() &&
    !isCreating &&
    !myBindings.isLoading &&
    (ownedBy === "you" || selectedUserId);

  return (
    <Drawer.Root
      placement="end"
      size="lg"
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) {
          onClose();
          resetForm();
        }
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Heading size="md">Create new secret key</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="start">
            {/* Owned by — only show when admin (non-admins always create for themselves) */}
            {isAdmin && (
              <VStack gap={2} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Owned by
                </Text>
                <SegmentGroup.Root
                  size="sm"
                  value={ownedBy}
                  onValueChange={(e) =>
                    setOwnedBy(e.value as "you" | "service" | "other")
                  }
                >
                  <SegmentGroup.Indicator />
                  <SegmentGroup.Item value="you">
                    <SegmentGroup.ItemText>You</SegmentGroup.ItemText>
                    <SegmentGroup.ItemHiddenInput />
                  </SegmentGroup.Item>
                  <SegmentGroup.Item value="service">
                    <SegmentGroup.ItemText>Service account</SegmentGroup.ItemText>
                    <SegmentGroup.ItemHiddenInput />
                  </SegmentGroup.Item>
                  <SegmentGroup.Item value="other">
                    <SegmentGroup.ItemText>Other user</SegmentGroup.ItemText>
                    <SegmentGroup.ItemHiddenInput />
                  </SegmentGroup.Item>
                </SegmentGroup.Root>
                {ownedBy === "you" && (
                  <Text fontSize="xs" color="fg.muted">
                    This API key is tied to your user. If you are removed from
                    the organization, this key will be disabled.
                  </Text>
                )}
                {ownedBy === "service" && (
                  <Text fontSize="xs" color="fg.muted">
                    A service key has full project access and is not tied to any
                    user. It can be used by anyone in the team.
                  </Text>
                )}
                {ownedBy === "other" && (
                  <VStack gap={2} align="start" width="full">
                    <Text fontSize="xs" color="fg.muted">
                      The key will be owned by the selected user. Their
                      permissions act as the ceiling.
                    </Text>
                    <Select.Root
                      collection={memberCollection}
                      value={selectedUserId ? [selectedUserId] : []}
                      onValueChange={(details) => {
                        const val = details.value[0] ?? "";
                        setSelectedUserId(val);
                      }}
                    >
                      <Select.Trigger width="full" background="bg">
                        <Select.ValueText placeholder="Select a user..." />
                      </Select.Trigger>
                      <Select.Content>
                        {memberCollection.items.map((item) => (
                          <Select.Item key={item.value} item={item}>
                            {item.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </VStack>
                )}
              </VStack>
            )}

            {/* Name */}
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Name
              </Text>
              <Input
                placeholder="e.g., CI Pipeline, Local Dev"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </VStack>

            {/* Description */}
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Description{" "}
                <Text as="span" color="fg.muted" fontWeight="400">
                  (optional)
                </Text>
              </Text>
              <Textarea
                placeholder="What is this key used for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                resize="vertical"
              />
            </VStack>

            {/* Permissions — hidden for service accounts (full access) */}
            {ownedBy !== "service" && <VStack gap={2} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Permissions
              </Text>
              <SegmentGroup.Root
                size="sm"
                value={permissionMode}
                onValueChange={(e) =>
                  setPermissionMode(e.value as PermissionMode)
                }
              >
                <SegmentGroup.Indicator />
                <SegmentGroup.Item value="all">
                  <SegmentGroup.ItemText>All</SegmentGroup.ItemText>
                  <SegmentGroup.ItemHiddenInput />
                </SegmentGroup.Item>
                <SegmentGroup.Item value="restricted">
                  <SegmentGroup.ItemText>Restricted</SegmentGroup.ItemText>
                  <SegmentGroup.ItemHiddenInput />
                </SegmentGroup.Item>
                <SegmentGroup.Item value="readonly">
                  <SegmentGroup.ItemText>Read only</SegmentGroup.ItemText>
                  <SegmentGroup.ItemHiddenInput />
                </SegmentGroup.Item>
              </SegmentGroup.Root>

              {permissionMode === "restricted" && (
                <Box
                  width="full"
                  padding={3}
                  borderWidth="1px"
                  borderColor="border"
                  borderRadius="md"
                  background="bg.subtle"
                >
                  <Text fontSize="sm" marginBottom={2}>
                    Set a role for each project:
                  </Text>
                  {orgProjects.length === 0 ? (
                    <Text fontSize="xs" color="fg.muted">
                      No projects found in this organization.
                    </Text>
                  ) : (
                  <VStack align="stretch" gap={2}>
                    {orgProjects.map((project) => {
                      const effectiveRole = projectRoles[project.id] ?? "NONE";
                      const roleOptions = createListCollection({
                        items: [
                          ...STANDARD_ROLES.map((r) => ({
                            label: ROLE_LABELS[r] ?? r,
                            value: r,
                          })),
                          { label: "None", value: "NONE" },
                        ],
                      });

                      return (
                        <HStack
                          key={project.id}
                          gap={3}
                          fontSize="sm"
                          width="full"
                          align="center"
                        >
                          <Text
                            color="fg"
                            flex="1"
                            fontWeight="500"
                            lineHeight="32px"
                          >
                            {project.name}
                          </Text>
                          <Select.Root
                            collection={roleOptions}
                            size="sm"
                            value={[effectiveRole]}
                            onValueChange={(details) => {
                              const val = details.value[0];
                              if (val) {
                                setProjectRoles((prev) => ({
                                  ...prev,
                                  [project.id]: val,
                                }));
                              }
                            }}
                            width="140px"
                          >
                            <Select.Trigger
                              width="140px"
                              aria-label={`Role for ${project.name}`}
                            >
                              <Select.ValueText />
                            </Select.Trigger>
                            <Select.Content>
                              {roleOptions.items.map((opt) => (
                                <Select.Item key={opt.value} item={opt}>
                                  {opt.label}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Root>
                        </HStack>
                      );
                    })}
                  </VStack>
                  )}
                  <Text fontSize="xs" color="fg.muted" marginTop={3}>
                    Your access acts as a ceiling. If your role is later
                    reduced, the key loses those permissions automatically.
                  </Text>
                </Box>
              )}
            </VStack>}

            {/* Expiration */}
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
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleCreate}
              disabled={!canCreate}
            >
              Create secret key
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
