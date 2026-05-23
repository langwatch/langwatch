import {
  Badge,
  Box,
  Button,
  Drawer,
  HStack,
  Input,
  Spacer,
  Spinner,
  Table,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { OttlEditor } from "@ee/governance/dashboard/components/OttlEditor";

import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

/**
 * Admin Ingestion Templates editor — second tab on
 * /settings/governance/tool-catalog. Per
 * `specs/ai-governance/admin-ottl-authoring.feature`:
 *
 *   - Platform-published rows render read-only with a 'View OTTL'
 *     button + a 'Clone to customise' affordance.
 *   - Org-authored rows render editable with 'Edit OTTL' (opens drawer
 *     containing the OttlEditor wired to validateOttl) + 'Archive'.
 *   - Admins can also author a brand-new template via 'New template'.
 *
 * The OttlEditor reuses the same validation pipeline as IngestionSource
 * authoring (proxies to gateway pkg/ottl). No new validation surface.
 */
type EditorState =
  | { kind: "view"; templateId: string; slug: string }
  | { kind: "edit"; templateId: string; slug: string; sourceType: string }
  | { kind: "create" }
  | null;

export function IngestionTemplatesEditor({
  organizationId,
}: {
  organizationId: string;
}) {
  const utils = api.useUtils();
  const listQuery = api.ingestionTemplates.adminList.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  const [editorState, setEditorState] = useState<EditorState>(null);

  const cloneMutation = api.ingestionTemplates.cloneFromPlatform.useMutation({
    onSuccess: (row) => {
      void utils.ingestionTemplates.adminList.invalidate();
      if (row) {
        setEditorState({
          kind: "edit",
          templateId: row.id,
          slug: row.slug,
          sourceType: row.sourceType,
        });
        toaster.create({
          title: "Cloned",
          description: `Created ${row.displayName}. Edit OTTL on the cloned row.`,
          type: "success",
        });
      }
    },
    onError: (err) => {
      toaster.create({
        title: "Clone failed",
        description: err.message,
        type: "error",
      });
    },
  });

  const archiveMutation = api.ingestionTemplates.archive.useMutation({
    onSuccess: () => {
      void utils.ingestionTemplates.adminList.invalidate();
      toaster.create({ title: "Template archived", type: "success" });
    },
    onError: (err) => {
      toaster.create({
        title: "Archive failed",
        description: err.message,
        type: "error",
      });
    },
  });

  if (listQuery.isLoading) {
    return (
      <Box padding={6} textAlign="center">
        <Spinner size="sm" />
      </Box>
    );
  }

  const templates = listQuery.data ?? [];

  return (
    <VStack align="stretch" gap={3} width="full">
      <HStack>
        <Spacer />
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditorState({ kind: "create" })}
        >
          <Plus size={14} /> New template
        </Button>
      </HStack>

      {templates.length === 0 ? (
        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          padding={6}
          backgroundColor="bg.subtle"
        >
          <VStack align="start" gap={2}>
            <Text fontSize="sm" fontWeight="medium">
              No ingestion templates yet
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Platform defaults seed lazily on first /me Trace Ingest visit.
              Click 'New template' to author a custom one for this org.
            </Text>
          </VStack>
        </Box>
      ) : (
        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          overflow="hidden"
        >
          <Table.Root size="sm">
            <Table.Header backgroundColor="bg.subtle">
              <Table.Row>
                <Table.ColumnHeader>Template</Table.ColumnHeader>
                <Table.ColumnHeader>Source</Table.ColumnHeader>
                <Table.ColumnHeader>Scope</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {templates.map((t) => (
                <Table.Row key={t.id}>
                  <Table.Cell>
                    <VStack align="start" gap={0}>
                      <Text fontSize="sm" fontWeight="medium">
                        {t.displayName}
                      </Text>
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                        {t.slug}
                      </Text>
                    </VStack>
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontSize="xs" fontFamily="mono">
                      {t.sourceType}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {t.platformPublished ? (
                      <Badge size="sm" variant="surface" colorPalette="blue">
                        Platform
                      </Badge>
                    ) : (
                      <Badge size="sm" variant="surface" colorPalette="purple">
                        Org-authored
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {t.enabled ? (
                      <Badge size="sm" variant="surface" colorPalette="green">
                        Enabled
                      </Badge>
                    ) : (
                      <Badge size="sm" variant="surface" colorPalette="gray">
                        Disabled
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    <HStack gap={1} justify="flex-end">
                      {t.platformPublished ? (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              setEditorState({
                                kind: "view",
                                templateId: t.id,
                                slug: t.slug,
                              })
                            }
                          >
                            <Eye size={12} /> View
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            loading={
                              cloneMutation.isPending &&
                              cloneMutation.variables?.sourceTemplateId === t.id
                            }
                            onClick={() =>
                              cloneMutation.mutate({
                                organizationId,
                                sourceTemplateId: t.id,
                              })
                            }
                          >
                            Clone to customise
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              setEditorState({
                                kind: "edit",
                                templateId: t.id,
                                slug: t.slug,
                                sourceType: t.sourceType,
                              })
                            }
                          >
                            <Pencil size={12} /> Edit OTTL
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            loading={
                              archiveMutation.isPending &&
                              archiveMutation.variables?.id === t.id
                            }
                            onClick={() => {
                              archiveMutation.mutate({
                                organizationId,
                                id: t.id,
                              });
                            }}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </>
                      )}
                    </HStack>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}

      <HStack>
        <Spacer />
        <Text fontSize="xs" color="fg.muted">
          OTTL authoring guide:{" "}
          <Link
            href="/docs/ai-governance/ingestion-templates"
            color="orange.600"
          >
            two-tier trust model
          </Link>
          .
        </Text>
      </HStack>

      <ViewOttlDrawer
        organizationId={organizationId}
        state={editorState}
        onClose={() => setEditorState(null)}
      />
      <EditOttlDrawer
        organizationId={organizationId}
        state={editorState}
        onClose={() => setEditorState(null)}
      />
      <CreateTemplateDrawer
        organizationId={organizationId}
        state={editorState}
        onClose={() => setEditorState(null)}
        onCreated={(row) => {
          setEditorState(
            row
              ? {
                  kind: "edit",
                  templateId: row.id,
                  slug: row.slug,
                  sourceType: row.sourceType,
                }
              : null,
          );
        }}
      />
    </VStack>
  );
}

function ViewOttlDrawer({
  organizationId,
  state,
  onClose,
}: {
  organizationId: string;
  state: EditorState;
  onClose: () => void;
}) {
  const open = state?.kind === "view";
  const detailQuery = api.ingestionTemplates.get.useQuery(
    {
      organizationId,
      id: state?.kind === "view" ? state.templateId : "",
    },
    { enabled: open, refetchOnWindowFocus: false },
  );

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(d) => {
        if (!d.open) onClose();
      }}
      size="lg"
    >
      <Drawer.Backdrop />
      <Drawer.Positioner>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>
              OTTL — {state?.kind === "view" ? state.slug : ""}
            </Drawer.Title>
            <Drawer.CloseTrigger />
          </Drawer.Header>
          <Drawer.Body>
            <VStack align="stretch" gap={3}>
              <Text fontSize="xs" color="fg.muted">
                Platform-authored OTTL. Read-only — clone the row from the
                catalog table to customise it for this org.
              </Text>
              {detailQuery.isLoading ? (
                <Spinner size="sm" />
              ) : detailQuery.data ? (
                <Box
                  as="pre"
                  fontSize="xs"
                  fontFamily="mono"
                  whiteSpace="pre-wrap"
                  backgroundColor="bg.subtle"
                  padding={3}
                  borderRadius="sm"
                  borderWidth="1px"
                  borderColor="border.muted"
                  maxHeight="400px"
                  overflow="auto"
                >
                  {detailQuery.data.ottlRules || "(no OTTL rules)"}
                </Box>
              ) : (
                <Text fontSize="sm" color="fg.muted">
                  Template not found.
                </Text>
              )}
            </VStack>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Positioner>
    </Drawer.Root>
  );
}

function EditOttlDrawer({
  organizationId,
  state,
  onClose,
}: {
  organizationId: string;
  state: EditorState;
  onClose: () => void;
}) {
  const open = state?.kind === "edit";
  const detailQuery = api.ingestionTemplates.get.useQuery(
    {
      organizationId,
      id: state?.kind === "edit" ? state.templateId : "",
    },
    { enabled: open, refetchOnWindowFocus: false },
  );

  const [statements, setStatements] = useState<string[]>([]);
  useEffect(() => {
    if (detailQuery.data) {
      const lines = detailQuery.data.ottlRules
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      setStatements(lines.length > 0 ? lines : [""]);
    } else {
      setStatements([]);
    }
  }, [detailQuery.data]);

  const utils = api.useUtils();
  const updateMutation = api.ingestionTemplates.updateOttlRules.useMutation({
    onSuccess: () => {
      void utils.ingestionTemplates.adminList.invalidate();
      void utils.ingestionTemplates.get.invalidate();
      toaster.create({ title: "OTTL saved", type: "success" });
      onClose();
    },
    onError: (err) => {
      toaster.create({
        title: "Save failed",
        description: err.message,
        type: "error",
      });
    },
  });

  const handleSave = () => {
    if (state?.kind !== "edit") return;
    const cleaned = statements
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join("\n");
    updateMutation.mutate({
      organizationId,
      id: state.templateId,
      ottlRules: cleaned,
    });
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(d) => {
        if (!d.open) onClose();
      }}
      size="lg"
    >
      <Drawer.Backdrop />
      <Drawer.Positioner>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>
              Edit OTTL — {state?.kind === "edit" ? state.slug : ""}
            </Drawer.Title>
            <Drawer.CloseTrigger />
          </Drawer.Header>
          <Drawer.Body>
            <VStack align="stretch" gap={3}>
              <Text fontSize="xs" color="fg.muted">
                Each line is one OTTL statement. Validation runs against the
                gateway parser as you type. The receiver applies these AFTER
                stamping the binding's authoritative principal + provenance
                keys, so OTTL cannot forge attribution.
              </Text>
              {detailQuery.isLoading ? (
                <Spinner size="sm" />
              ) : (
                state?.kind === "edit" && (
                  <OttlEditor
                    organizationId={organizationId}
                    sourceType={state.sourceType}
                    statements={statements}
                    onChange={setStatements}
                    enabled={true}
                  />
                )
              )}
            </VStack>
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              loading={updateMutation.isPending}
              onClick={handleSave}
            >
              Save OTTL
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Positioner>
    </Drawer.Root>
  );
}

function CreateTemplateDrawer({
  organizationId,
  state,
  onClose,
  onCreated,
}: {
  organizationId: string;
  state: EditorState;
  onClose: () => void;
  onCreated: (
    row: { id: string; slug: string; sourceType: string } | null,
  ) => void;
}) {
  const open = state?.kind === "create";

  const [displayName, setDisplayName] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) {
      setDisplayName("");
      setSourceType("");
      setDescription("");
    }
  }, [open]);

  const utils = api.useUtils();
  const createMutation = api.ingestionTemplates.create.useMutation({
    onSuccess: (row) => {
      void utils.ingestionTemplates.adminList.invalidate();
      toaster.create({ title: "Template created", type: "success" });
      if (row) {
        onCreated({ id: row.id, slug: row.slug, sourceType: row.sourceType });
      } else {
        onClose();
      }
    },
    onError: (err) => {
      toaster.create({
        title: "Create failed",
        description: err.message,
        type: "error",
      });
    },
  });

  const canSubmit =
    displayName.trim().length > 0 && /^[a-z0-9_]{1,40}$/.test(sourceType);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(d) => {
        if (!d.open) onClose();
      }}
      size="md"
    >
      <Drawer.Backdrop />
      <Drawer.Positioner>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>New ingestion template</Drawer.Title>
            <Drawer.CloseTrigger />
          </Drawer.Header>
          <Drawer.Body>
            <VStack align="stretch" gap={3}>
              <VStack align="stretch" gap={1}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Display name
                </Text>
                <Input
                  size="sm"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Internal Codex Wrapper"
                />
              </VStack>
              <VStack align="stretch" gap={1}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Source type
                </Text>
                <Input
                  size="sm"
                  value={sourceType}
                  onChange={(e) =>
                    setSourceType(
                      e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                    )
                  }
                  fontFamily="mono"
                  placeholder="e.g. codex_internal"
                />
                <Text fontSize="xs" color="fg.muted">
                  Lowercase letters / digits / underscores only. Drives the
                  /me Trace Ingest tile slug + the langwatch.source provenance
                  attribute on emitted spans.
                </Text>
              </VStack>
              <VStack align="stretch" gap={1}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Description (optional)
                </Text>
                <Textarea
                  size="sm"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this template do? Shown to end users on the install tile."
                />
              </VStack>
              <Text fontSize="xs" color="fg.muted">
                After creation, you'll edit the OTTL rules in the next step.
                The template starts with empty rules — admin authoring
                continues there.
              </Text>
            </VStack>
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              disabled={!canSubmit}
              loading={createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  organizationId,
                  sourceType,
                  displayName: displayName.trim(),
                  description: description.trim() || undefined,
                })
              }
            >
              Create + edit OTTL
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Positioner>
    </Drawer.Root>
  );
}
