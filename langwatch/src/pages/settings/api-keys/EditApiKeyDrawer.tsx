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
import { useEffect, useState } from "react";
import { Drawer } from "../../../components/ui/drawer";
import { Select } from "../../../components/ui/select";
import type { RouterOutputs } from "../../../utils/api";
import {
  ROLE_LABELS,
  STANDARD_ROLES,
  type PermissionMode,
} from "./utils";

type ApiKeyRow = RouterOutputs["apiKey"]["list"][number];
type MyBindingsData = RouterOutputs["apiKey"]["myBindings"];
type MyBindings = {
  data: MyBindingsData | undefined;
  isLoading: boolean;
};
type OrgProject = { id: string; name: string };

export function EditApiKeyDrawer({
  apiKey,
  isUpdating,
  myBindings,
  orgProjects,
  onClose,
  onSave,
}: {
  apiKey: ApiKeyRow | null;
  isUpdating: boolean;
  myBindings: MyBindings;
  orgProjects: OrgProject[];
  onClose: () => void;
  onSave: (input: {
    apiKeyId: string;
    name?: string;
    description?: string | null;
    permissionMode?: PermissionMode;
    bindings?: Array<{
      role: string;
      customRoleId: string | null | undefined;
      scopeType: string;
      scopeId: string;
    }>;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("all");
  const [projectRoles, setProjectRoles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (apiKey) {
      setName(apiKey.name);
      setDescription(apiKey.description ?? "");
      setPermissionMode((apiKey.permissionMode as PermissionMode) ?? "all");

      // Pre-populate project roles from existing bindings
      const roles: Record<string, string> = {};
      for (const rb of apiKey.roleBindings) {
        if (rb.scopeType === "PROJECT") {
          roles[rb.scopeId] = rb.role;
        }
      }
      setProjectRoles(roles);
    }
  }, [apiKey]);

  const buildBindings = () => {
    if (!myBindings.data) return [];

    if (permissionMode === "all") {
      return myBindings.data.map((b) => ({
        role: b.role,
        customRoleId: b.customRoleId,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      }));
    }

    if (permissionMode === "readonly") {
      return myBindings.data.map((b) => ({
        role: "VIEWER" as const,
        customRoleId: null,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      }));
    }

    // Restricted: per-project roles
    return orgProjects
      .filter((p) => (projectRoles[p.id] ?? "NONE") !== "NONE")
      .map((p) => ({
        role: projectRoles[p.id] ?? "VIEWER",
        customRoleId: null,
        scopeType: "PROJECT" as const,
        scopeId: p.id,
      }));
  };

  const handleSave = () => {
    if (!apiKey) return;
    onSave({
      apiKeyId: apiKey.id,
      name: name !== apiKey.name ? name : undefined,
      description:
        description !== (apiKey.description ?? "")
          ? description || null
          : undefined,
      permissionMode,
      bindings: buildBindings(),
    });
  };

  return (
    <Drawer.Root
      placement="end"
      size="lg"
      open={!!apiKey}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Heading size="md">Edit API key</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="start">
            {/* Name */}
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Name
              </Text>
              <Input
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
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                resize="vertical"
              />
            </VStack>

            {/* Permissions */}
            <VStack gap={2} align="start" width="full">
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
                  <Text fontSize="xs" color="fg.muted" marginTop={3}>
                    Your access acts as a ceiling. If your role is later
                    reduced, the key loses those permissions automatically.
                  </Text>
                </Box>
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
              onClick={handleSave}
              disabled={isUpdating || !name.trim()}
            >
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
