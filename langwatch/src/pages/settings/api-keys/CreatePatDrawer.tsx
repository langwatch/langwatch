import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { Drawer } from "../../../components/ui/drawer";
import { Select } from "../../../components/ui/select";
import type { RouterOutputs } from "../../../utils/api";
import { EXPIRATION_OPTIONS, expirationCollection } from "./utils";

type MyBindingsData = RouterOutputs["personalAccessToken"]["myBindings"];
type MyBindings = {
  data: MyBindingsData | undefined;
  isLoading: boolean;
};

export type CreatePatInput = {
  name: string;
  description: string;
  expiresAt: Date | undefined;
};

/**
 * Drawer form for creating a new PAT. Owns the transient form state
 * (name / description / expiration) and clears it every time it closes so
 * re-opening starts from a blank slate. The parent owns the network call
 * and token-display lifecycle.
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
  };

  const handleCreate = () => {
    let expiresAt: Date | undefined;
    if (expirationPreset === "custom" && customDate) {
      expiresAt = new Date(customDate);
    } else if (expirationPreset && expirationPreset !== "custom") {
      const days = parseInt(expirationPreset, 10);
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    onCreate({ name, description, expiresAt });
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
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
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
