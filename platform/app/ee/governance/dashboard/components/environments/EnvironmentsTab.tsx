// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  Badge,
  Box,
  Button,
  Field,
  HStack,
  Input,
  Table,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "~/components/ui/dialog";

import {
  discoverEnvironments,
  type EnvironmentRow,
  type EnvironmentSource,
  SAMPLE_ENVIRONMENTS,
} from "./discoveredEnvironments";

/**
 * The Environments pane: where an organization's agents run.
 *
 * Nothing in the database is an environment yet, so this table has two honest
 * sources and no third: rows DERIVED from the addresses configured sources
 * already point at, and rows the reader adds here — which live in this
 * component's own state and are gone on reload. The dialog says so in its own
 * words rather than pretending, because a form that looks like it saves and
 * does not is worse than no form.
 *
 * Spec: specs/ai-governance/dashboard/inventory-environments.feature
 */

function formatCreated(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The add form.
 *
 * Client-side only, and the dialog says exactly that above the buttons. The
 * row it produces is real enough to look at and gone on reload — which is the
 * truth about environments on this branch, told where the reader is about to
 * act on it rather than in a release note they will not read.
 */
export function AddEnvironmentDialog({
  isOpen,
  onClose,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (row: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const close = () => {
    setName("");
    setDescription("");
    onClose();
  };

  return (
    <DialogRoot open={isOpen} onOpenChange={(e) => !e.open && close()}>
      <DialogContent maxWidth="lg">
        <DialogHeader>
          <DialogTitle>Add environment</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <VStack align="stretch" gap={4}>
            <Field.Root required>
              <Field.Label>Name</Field.Label>
              <Input
                size="sm"
                value={name}
                placeholder="Production"
                onChange={(e) => setName(e.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea
                size="sm"
                rows={3}
                value={description}
                placeholder="What runs here, and who it is for."
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field.Root>
            <Box
              role="note"
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="md"
              padding={3}
            >
              <Text fontSize="xs" color="fg.muted">
                Environments are not stored yet. This one stays on screen for as
                long as you have the page open and is gone when you reload.
              </Text>
            </Box>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            size="sm"
            colorPalette="orange"
            disabled={name.trim() === ""}
            onClick={() => {
              onAdd({ name: name.trim(), description: description.trim() });
              close();
            }}
          >
            Add environment
          </Button>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
}

/** Samples replace discovered and locally added environments until disabled. */
export function environmentRows({
  sources,
  sampleActive,
  added,
}: {
  sources: readonly EnvironmentSource[] | undefined;
  sampleActive: boolean;
  added: readonly EnvironmentRow[];
}): EnvironmentRow[] {
  if (sampleActive) return SAMPLE_ENVIRONMENTS;
  const discovered = discoverEnvironments({ sources: sources ?? [] });
  return [...discovered, ...added];
}

export function EnvironmentsTab({
  canRead = true,
  sources,
  sampleActive,
  added,
}: {
  /**
   * Whether the viewer may read the source list the discovered rows come from.
   * Same reasoning as the catalog pane: without it the table would report an
   * empty estate rather than an unreadable one.
   */
  canRead?: boolean;
  sources: readonly EnvironmentSource[] | undefined;
  sampleActive: boolean;
  added: readonly EnvironmentRow[];
}) {
  if (!canRead) {
    return (
      <PermissionRequiredNotice
        permission="ingestionSources:view"
        detail="Environments are discovered from the sources you have connected, so they stay hidden until then."
      />
    );
  }

  const rows = environmentRows({ sources, sampleActive, added });

  if (rows.length === 0) {
    return (
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        padding={8}
        textAlign="center"
      >
        <VStack gap={1}>
          <Text fontSize="sm" fontWeight="medium">
            No environments yet
          </Text>
          <Text fontSize="sm" color="fg.muted" maxWidth="460px">
            Environments appear here once a source points at one, such as a
            Power Platform environment or a Databricks workspace. You can also
            add one by hand with the button above.
          </Text>
        </VStack>
      </Box>
    );
  }

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      overflowX="auto"
    >
      <Table.Root size="sm" data-testid="environments-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Name</Table.ColumnHeader>
            <Table.ColumnHeader>Description</Table.ColumnHeader>
            <Table.ColumnHeader>Created</Table.ColumnHeader>
            <Table.ColumnHeader>Created by</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <Table.Row key={row.id}>
              <Table.Cell>
                <HStack gap={2}>
                  <Text fontWeight="medium">{row.name}</Text>
                  {row.discoveredFrom && (
                    <Badge size="xs" variant="surface" colorPalette="purple">
                      Discovered from {row.discoveredFrom}
                    </Badge>
                  )}
                  {row.sample && (
                    <Badge size="xs" variant="surface" colorPalette="orange">
                      sample
                    </Badge>
                  )}
                </HStack>
              </Table.Cell>
              <Table.Cell color="fg.muted">{row.description}</Table.Cell>
              <Table.Cell color="fg.muted">
                {formatCreated(row.createdIso)}
              </Table.Cell>
              <Table.Cell color="fg.muted">{row.createdBy}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
