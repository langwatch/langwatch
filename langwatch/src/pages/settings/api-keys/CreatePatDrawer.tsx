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
import type { RouterInputs, RouterOutputs } from "../../../utils/api";
import { EXPIRATION_OPTIONS, expirationCollection } from "./utils";

type MyBindingsData = RouterOutputs["personalAccessToken"]["myBindings"];
type MyBindings = {
  data: MyBindingsData | undefined;
  isLoading: boolean;
};

type RoleBindingInput =
  RouterInputs["personalAccessToken"]["create"]["bindings"][number];

type PermissionMode = "all" | "readonly" | "restricted";

const STANDARD_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;

function rolesAtOrBelow(
  role: string,
): Array<{ label: string; value: string }> {
  const idx = STANDARD_ROLES.indexOf(
    role as (typeof STANDARD_ROLES)[number],
  );
  if (idx === -1) return [];
  return STANDARD_ROLES.slice(idx).map((r) => ({ label: r, value: r }));
}

export type CreatePatInput = {
  name: string;
  description: string;
  expiresAt: Date | undefined;
  bindings: RoleBindingInput[];
};

/**
 * Drawer form for creating a new PAT. Owns the transient form state
 * (name / description / expiration / permission mode) and clears it every
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
  const [permissionMode, setPermissionMode] =
    useState<PermissionMode>("all");
  const [roleOverrides, setRoleOverrides] = useState<
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

  const resetForm = () => {
    setName("");
    setDescription("");
    setExpirationPreset("");
    setCustomDate("");
    setPermissionMode("all");
    setRoleOverrides({});
  };

  const computeBindings = (): CreatePatInput["bindings"] => {
    const data = myBindings.data;
    if (!data) return [];
    switch (permissionMode) {
      case "all":
        return data.map((b) => ({
          role: b.role,
          customRoleId: b.customRoleId,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        }));
      case "readonly":
        return data.map((b) => ({
          role: "VIEWER" as const,
          customRoleId: null,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        }));
      case "restricted":
        return data.map((b) => {
          const overriddenRole = roleOverrides[b.id] as
            | RoleBindingInput["role"]
            | undefined;
          if (overriddenRole && overriddenRole !== b.role) {
            return {
              role: overriddenRole,
              customRoleId: null,
              scopeType: b.scopeType,
              scopeId: b.scopeId,
            };
          }
          return {
            role: b.role,
            customRoleId: b.customRoleId,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          };
        });
    }
  };

  const handleCreate = () => {
    let expiresAt: Date | undefined;
    if (expirationPreset === "custom" && customDate) {
      expiresAt = new Date(customDate);
    } else if (expirationPreset && expirationPreset !== "custom") {
      const days = parseInt(expirationPreset, 10);
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    onCreate({
      name,
      description,
      expiresAt,
      bindings: computeBindings(),
    });
  };

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
                Access
              </Text>
              <RadioGroup
                value={permissionMode}
                onChange={(e) =>
                  setPermissionMode(e.target.value as PermissionMode)
                }
              >
                <HStack gap={4}>
                  <Radio value="all">All permissions</Radio>
                  <Radio value="readonly">Read only</Radio>
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
                {permissionMode === "all" && (
                  <Text fontSize="sm">
                    This token will inherit{" "}
                    <Text as="span" fontWeight="600">
                      your current permissions
                    </Text>{" "}
                    in this organization:
                  </Text>
                )}
                {permissionMode === "readonly" && (
                  <Text fontSize="sm">
                    This token will have{" "}
                    <Text as="span" fontWeight="600">
                      read-only access
                    </Text>{" "}
                    (Viewer role) at every scope:
                  </Text>
                )}
                {permissionMode === "restricted" && (
                  <Text fontSize="sm">
                    Choose a role for each scope, capped by your current
                    permissions:
                  </Text>
                )}
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

                      const isCustom = b.role === "CUSTOM";
                      const availableRoles = rolesAtOrBelow(b.role);
                      const effectiveRole =
                        permissionMode === "readonly"
                          ? "VIEWER"
                          : permissionMode === "restricted"
                            ? (roleOverrides[b.id] ?? b.role)
                            : b.role;
                      const roleLabel =
                        isCustom && permissionMode !== "readonly"
                          ? (b.customRoleName ?? "Custom")
                          : effectiveRole;

                      const showSelector =
                        permissionMode === "restricted" &&
                        !isCustom &&
                        availableRoles.length > 1;

                      return (
                        <HStack key={b.id} gap={2} fontSize="xs">
                          {showSelector ? (
                            <Select.Root
                              collection={createListCollection({
                                items: availableRoles,
                              })}
                              size="xs"
                              value={[effectiveRole]}
                              onValueChange={(details) => {
                                const val = details.value[0];
                                if (val)
                                  setRoleOverrides((prev) => ({
                                    ...prev,
                                    [b.id]: val,
                                  }));
                              }}
                            >
                              <Select.Trigger minWidth="100px">
                                <Select.ValueText />
                              </Select.Trigger>
                              <Select.Content>
                                {availableRoles.map((opt) => (
                                  <Select.Item
                                    key={opt.value}
                                    item={opt}
                                  >
                                    {opt.label}
                                  </Select.Item>
                                ))}
                              </Select.Content>
                            </Select.Root>
                          ) : (
                            <Badge size="sm" variant="subtle">
                              {roleLabel}
                            </Badge>
                          )}
                          <Text color="fg.muted">{scopeLabel}</Text>
                        </HStack>
                      );
                    })}
                  </VStack>
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
