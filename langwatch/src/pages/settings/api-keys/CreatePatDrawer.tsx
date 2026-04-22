import {
  Badge,
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
import {
  computeBindings,
  EXPIRATION_OPTIONS,
  expirationCollection,
  ROLE_LABELS,
  rolesAtOrBelow,
  type PermissionMode,
} from "./utils";

type MyBindingsData = RouterOutputs["personalAccessToken"]["myBindings"];
type MyBindings = {
  data: MyBindingsData | undefined;
  isLoading: boolean;
};

export type CreatePatInput = {
  name: string;
  description: string;
  expiresAt: Date | undefined;
  bindings: Array<{
    role: string;
    customRoleId: string | null | undefined;
    scopeType: string;
    scopeId: string;
  }>;
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

  const roleCollections = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof createListCollection<{ label: string; value: string }>>
    >();
    if (!myBindings.data) return map;
    for (const b of myBindings.data) {
      if (!map.has(b.role)) {
        map.set(
          b.role,
          createListCollection({ items: rolesAtOrBelow(b.role) }),
        );
      }
    }
    return map;
  }, [myBindings.data]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setExpirationPreset("");
    setCustomDate("");
    setPermissionMode("all");
    setRoleOverrides({});
  };

  // Reset form whenever the drawer opens — catches cases where
  // onOpenChange doesn't fire on programmatic open-prop changes
  // (e.g. when the token dialog hides/shows the drawer via !newToken).
  useEffect(() => {
    if (isOpen) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleCreate = () => {
    let expiresAt: Date | undefined;
    if (expirationPreset === "custom" && customDate) {
      expiresAt = new Date(customDate);
    } else if (expirationPreset && expirationPreset !== "custom") {
      const days = parseInt(expirationPreset, 10);
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    const bindings = computeBindings({
      data: myBindings.data,
      permissionMode,
      roleOverrides,
    });
    onCreate({ name, description, expiresAt, bindings });
    resetForm();
  };

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
              <SegmentGroup.Root
                size="sm"
                value={permissionMode}
                onValueChange={(e) => {
                  setPermissionMode(e.value as PermissionMode);
                }}
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
                  <VStack align="stretch" gap={2} marginTop={2}>
                    {myBindings.data!.map((b) => {
                      const scopeLabel =
                        b.scopeType === "ORGANIZATION"
                          ? "Org-wide"
                          : b.scopeType === "TEAM"
                            ? `Team: ${b.scopeName ?? b.scopeId}`
                            : `Project: ${b.scopeName ?? b.scopeId}`;

                      const isCustom = b.role === "CUSTOM";
                      const collection = roleCollections.get(b.role);
                      const availableRoles = collection?.items ?? [];
                      const effectiveRole =
                        permissionMode === "readonly"
                          ? "VIEWER"
                          : permissionMode === "restricted"
                            ? (roleOverrides[b.id] ?? b.role)
                            : b.role;
                      const roleLabel =
                        isCustom && permissionMode !== "readonly"
                          ? (b.customRoleName ?? "Custom")
                          : (ROLE_LABELS[effectiveRole] ?? effectiveRole);

                      const showSelector =
                        permissionMode === "restricted" &&
                        !isCustom &&
                        availableRoles.length > 1;

                      return (
                        <HStack
                          key={b.id}
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
                            {scopeLabel}
                          </Text>
                          {showSelector && collection ? (
                            <Select.Root
                              collection={collection}
                              size="sm"
                              value={[effectiveRole]}
                              onValueChange={(details) => {
                                const val = details.value[0];
                                if (val)
                                  setRoleOverrides((prev) => ({
                                    ...prev,
                                    [b.id]: val,
                                  }));
                              }}
                              width="140px"
                            >
                              <Select.Trigger
                                width="140px"
                                aria-label={`Role for ${scopeLabel}`}
                              >
                                <Select.ValueText />
                              </Select.Trigger>
                              <Select.Content>
                                {(collection?.items ?? []).map((opt) => (
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
                            <Text
                              color="fg.muted"
                              fontWeight="500"
                              width="140px"
                              textAlign="right"
                              flexShrink={0}
                              lineHeight="32px"
                            >
                              {roleLabel}
                            </Text>
                          )}
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
