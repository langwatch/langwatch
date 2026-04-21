import {
  Badge,
  Box,
  Button,
  createListCollection,
  Heading,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { Drawer } from "../../../components/ui/drawer";
import { Radio, RadioGroup } from "../../../components/ui/radio";
import { Select } from "../../../components/ui/select";
import type { RouterOutputs } from "../../../utils/api";
import { EXPIRATION_OPTIONS, expirationCollection } from "./utils";

type MyBindingsData = RouterOutputs["personalAccessToken"]["myBindings"];
type MyBindings = {
  data: MyBindingsData | undefined;
  isLoading: boolean;
};

type PermissionLevel = "all" | "readOnly" | "restricted";

type Role = "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
type ScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

type BindingInput = {
  role: Role;
  customRoleId: string | null | undefined;
  scopeType: ScopeType;
  scopeId: string;
};

export type CreatePatInput = {
  name: string;
  description: string;
  expiresAt: Date | undefined;
  bindings: BindingInput[];
};

const ROLE_HIERARCHY: readonly string[] = ["VIEWER", "MEMBER", "ADMIN"];

function rolesUpTo(ceiling: string): string[] {
  const idx = ROLE_HIERARCHY.indexOf(ceiling);
  if (idx === -1) return [ceiling];
  return [...ROLE_HIERARCHY.slice(0, idx + 1)];
}

function roleCollection(ceiling: string) {
  const roles = rolesUpTo(ceiling);
  return createListCollection({
    items: roles.map((r) => ({ label: r, value: r })),
  });
}

/**
 * Drawer form for creating a new PAT. Owns the transient form state
 * (name / description / expiration / permission level) and clears it every
 * time it closes so re-opening starts from a blank slate. The parent owns
 * the network call and token-display lifecycle.
 */
export function CreatePatDrawer({
  isOpen,
  isCreating,
  myBindings,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  isCreating: boolean;
  myBindings: MyBindings;
  onClose: () => void;
  onCreate: (input: CreatePatInput) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expirationPreset, setExpirationPreset] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [permissionLevel, setPermissionLevel] =
    useState<PermissionLevel>("all");
  const [restrictedRoles, setRestrictedRoles] = useState<
    Record<string, string>
  >({});

  const minCustomDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const effectiveBindings = useMemo((): BindingInput[] => {
    if (!myBindings.data) return [];
    switch (permissionLevel) {
      case "all":
        return myBindings.data.map((b) => ({
          role: b.role,
          customRoleId: b.customRoleId,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        }));
      case "readOnly":
        return myBindings.data.map((b) => ({
          role: "VIEWER",
          customRoleId: null,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        }));
      case "restricted":
        return myBindings.data.map((b) => ({
          role: (restrictedRoles[b.id] as Role | undefined) ?? b.role,
          customRoleId:
            restrictedRoles[b.id] && restrictedRoles[b.id] !== b.role
              ? null
              : b.customRoleId,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        }));
    }
  }, [myBindings.data, permissionLevel, restrictedRoles]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setExpirationPreset("");
    setCustomDate("");
    setPermissionLevel("all");
    setRestrictedRoles({});
  };

  const handleCreate = () => {
    let expiresAt: Date | undefined;
    if (expirationPreset === "custom" && customDate) {
      expiresAt = new Date(customDate);
    } else if (expirationPreset && expirationPreset !== "custom") {
      const days = parseInt(expirationPreset, 10);
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    onCreate({ name, description, expiresAt, bindings: effectiveBindings });
  };

  const scopeLabel = (b: MyBindingsData[number]) =>
    b.scopeType === "ORGANIZATION"
      ? "Org-wide"
      : b.scopeType === "TEAM"
        ? `Team: ${b.scopeName ?? b.scopeId}`
        : `Project: ${b.scopeName ?? b.scopeId}`;

  const roleLabel = (b: MyBindingsData[number]) =>
    b.role === "CUSTOM" ? (b.customRoleName ?? "Custom") : b.role;

  return (
    <Drawer.Root
      placement="end"
      size="md"
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
                Permissions
              </Text>
              <RadioGroup
                value={permissionLevel}
                onValueChange={(details) =>
                  setPermissionLevel(details.value as PermissionLevel)
                }
                size="sm"
              >
                <HStack gap={4}>
                  <Radio value="all">All</Radio>
                  <Radio value="readOnly">Read only</Radio>
                  <Radio value="restricted">Restricted</Radio>
                </HStack>
              </RadioGroup>
              <Box
                width="full"
                padding={3}
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                background="bg.subtle"
              >
                {permissionLevel === "all" && (
                  <>
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
                        {myBindings.data!.map((b) => (
                          <HStack key={b.id} gap={2} fontSize="xs">
                            <Badge size="sm" variant="subtle">
                              {roleLabel(b)}
                            </Badge>
                            <Text color="fg.muted">{scopeLabel(b)}</Text>
                          </HStack>
                        ))}
                      </VStack>
                    )}
                  </>
                )}

                {permissionLevel === "readOnly" && (
                  <>
                    <Text fontSize="sm">
                      This token will have{" "}
                      <Text as="span" fontWeight="600">
                        read-only (VIEWER)
                      </Text>{" "}
                      access at every scope:
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
                        {myBindings.data!.map((b) => (
                          <HStack key={b.id} gap={2} fontSize="xs">
                            <Badge size="sm" variant="subtle">
                              VIEWER
                            </Badge>
                            <Text color="fg.muted">{scopeLabel(b)}</Text>
                          </HStack>
                        ))}
                      </VStack>
                    )}
                  </>
                )}

                {permissionLevel === "restricted" && (
                  <>
                    <Text fontSize="sm">
                      Choose a role for each scope (capped by your ceiling):
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
                      <VStack align="stretch" gap={2} marginTop={2}>
                        {myBindings.data!.map((b) => {
                          const isCustom = b.role === "CUSTOM";
                          const collection = roleCollection(b.role);
                          const selectedRole =
                            restrictedRoles[b.id] ?? b.role;
                          return (
                            <HStack key={b.id} gap={2} fontSize="xs">
                              {isCustom ? (
                                <Badge size="sm" variant="subtle">
                                  {roleLabel(b)}
                                </Badge>
                              ) : (
                                <Select.Root
                                  collection={collection}
                                  value={[selectedRole]}
                                  onValueChange={(details) => {
                                    const val = details.value[0] ?? b.role;
                                    setRestrictedRoles((prev) => ({
                                      ...prev,
                                      [b.id]: val,
                                    }));
                                  }}
                                  size="xs"
                                >
                                  <Select.Trigger
                                    width="120px"
                                    background="bg"
                                  >
                                    <Select.ValueText />
                                  </Select.Trigger>
                                  <Select.Content
                                    width="120px"
                                    paddingY={1}
                                  >
                                    {collection.items.map((item) => (
                                      <Select.Item
                                        key={item.value}
                                        item={item}
                                      >
                                        {item.label}
                                      </Select.Item>
                                    ))}
                                  </Select.Content>
                                </Select.Root>
                              )}
                              <Text color="fg.muted">{scopeLabel(b)}</Text>
                            </HStack>
                          );
                        })}
                      </VStack>
                    )}
                  </>
                )}

                <Text fontSize="xs" color="fg.muted" marginTop={3}>
                  Your access acts as a ceiling. If your role is later
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
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleCreate}
              disabled={
                isCreating ||
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
  );
}
