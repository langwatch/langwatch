import {
  Badge,
  Box,
  Button,
  Card,
  EmptyState,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Spinner,
  Table,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import {
  GatewayGuardrailDirection,
  GatewayGuardrailFailureMode,
} from "@prisma/client";
import { Archive, Pencil, Plus, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import AiGatewayLayout from "~/components/gateway/AiGatewayLayout";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Drawer } from "~/components/ui/drawer";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type GuardrailRow = {
  id: string;
  name: string;
  description: string | null;
  evaluatorId: string;
  direction: GatewayGuardrailDirection;
  failureMode: GatewayGuardrailFailureMode;
  archivedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

const DIRECTION_LABEL: Record<GatewayGuardrailDirection, string> = {
  PRE: "Pre (request)",
  POST: "Post (response)",
  STREAM_CHUNK: "Stream chunk",
};

const DIRECTION_HELP: Record<GatewayGuardrailDirection, string> = {
  PRE: "Runs on the inbound request body before any provider call. Block returns 403 guardrail_blocked.",
  POST: "Runs on the assistant response before the client sees it. Block returns 403 + zero-cost debit.",
  STREAM_CHUNK:
    "Runs per visible SSE delta. Always fail-open per contract (50ms budget).",
};

const FAILURE_LABEL: Record<GatewayGuardrailFailureMode, string> = {
  FAIL_CLOSED: "Fail closed (block on evaluator error)",
  FAIL_OPEN: "Fail open (allow on evaluator error)",
};

function GuardrailsPage() {
  const { organization, project, hasPermission } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const canManage = hasPermission("gatewayGuardrails:manage");

  const listQuery = api.gatewayGuardrails.list.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );
  const monitorsQuery = api.monitors.getAllForProject.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );
  const utils = api.useContext();

  // executionMode AS_GUARDRAIL lives on Monitor (not Evaluator). A
  // guardrail-eligible binding is a Monitor with executionMode set and
  // a non-null evaluatorId — that FK is what GatewayGuardrail.evaluatorId
  // points at.
  const guardrailEvaluators = useMemo(
    () =>
      (monitorsQuery.data ?? [])
        .filter(
          (m: any) =>
            m.enabled &&
            m.executionMode === "AS_GUARDRAIL" &&
            typeof m.evaluatorId === "string" &&
            m.evaluatorId.length > 0,
        )
        .map((m: any) => ({
          id: m.evaluatorId as string,
          name: m.name as string,
          slug: m.slug as string,
        })),
    [monitorsQuery.data],
  );
  const evaluatorById = useMemo(() => {
    const map = new Map<string, { id: string; name: string; slug: string }>();
    for (const e of guardrailEvaluators) {
      map.set(e.id, e);
    }
    return map;
  }, [guardrailEvaluators]);

  const archiveMutation = api.gatewayGuardrails.archive.useMutation({
    onSuccess: async () => {
      if (projectId) {
        await utils.gatewayGuardrails.list.invalidate({ projectId });
      }
    },
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<GuardrailRow | null>(null);
  const [archiving, setArchiving] = useState<GuardrailRow | null>(null);

  const confirmArchive = async () => {
    if (!archiving || !projectId) return;
    try {
      await archiveMutation.mutateAsync({
        projectId,
        id: archiving.id,
      });
      setArchiving(null);
    } catch (error) {
      toaster.create({
        title:
          error instanceof Error ? error.message : "Failed to archive",
        type: "error",
      });
    }
  };

  const rows = (listQuery.data ?? []) as GuardrailRow[];
  const activeRows = rows.filter((r) => !r.archivedAt);

  if (!organization) {
    return (
      <AiGatewayLayout>
        <Spinner />
      </AiGatewayLayout>
    );
  }
  if (!projectId) {
    return (
      <AiGatewayLayout pageTitle="Guardrails · AI Gateway · LangWatch">
        <PageLayout.Header>
          <PageLayout.Heading>Guardrails</PageLayout.Heading>
        </PageLayout.Header>
        <Box paddingX={6} paddingY={4} width="full">
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <Shield size={36} />
              </EmptyState.Indicator>
              <EmptyState.Title>Pick a project first</EmptyState.Title>
              <EmptyState.Description>
                Guardrails are scoped per project. Use the project switcher in
                the top-left to pick a project before creating one.
              </EmptyState.Description>
            </EmptyState.Content>
          </EmptyState.Root>
        </Box>
      </AiGatewayLayout>
    );
  }

  return (
    <AiGatewayLayout pageTitle="Guardrails · AI Gateway · LangWatch">
      <PageLayout.Header>
        <PageLayout.Heading>Guardrails</PageLayout.Heading>
        <Spacer />
        {canManage && (
          <Button
            colorPalette="orange"
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={guardrailEvaluators.length === 0}
          >
            <Plus size={14} /> New guardrail
          </Button>
        )}
      </PageLayout.Header>

      <Box paddingX={6} paddingY={4} width="full">
        <VStack align="stretch" gap={4}>
          <Text fontSize="sm" color="fg.muted">
            Project-scoped LangWatch evaluators that run on every gateway
            request bound to this project. Pick a direction (pre / post /
            stream_chunk) and a failure mode (default fail closed). The VK
            opt-in lives in the virtual-key drawer.
          </Text>

          {listQuery.isLoading ? (
            <Spinner />
          ) : activeRows.length === 0 ? (
            <Card.Root>
              <Card.Body>
                <EmptyState.Root>
                  <EmptyState.Content>
                    <EmptyState.Indicator>
                      <Shield size={36} />
                    </EmptyState.Indicator>
                    <EmptyState.Title>No guardrails yet</EmptyState.Title>
                    <EmptyState.Description>
                      {guardrailEvaluators.length === 0 ? (
                        <>
                          No project evaluators are marked as guardrails. Open
                          Evaluations, edit an evaluator, and switch{" "}
                          <strong>executionMode</strong> to{" "}
                          <code>AS_GUARDRAIL</code> before binding it here.
                        </>
                      ) : (
                        <>
                          Click <strong>New guardrail</strong> to bind one of
                          your project evaluators as a pre / post /
                          stream_chunk hook.
                        </>
                      )}
                    </EmptyState.Description>
                  </EmptyState.Content>
                </EmptyState.Root>
              </Card.Body>
            </Card.Root>
          ) : (
            <Table.Root size="sm" variant="line">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Direction</Table.ColumnHeader>
                  <Table.ColumnHeader>Evaluator</Table.ColumnHeader>
                  <Table.ColumnHeader>Failure mode</Table.ColumnHeader>
                  <Table.ColumnHeader />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {activeRows.map((row) => {
                  const evaluator = evaluatorById.get(row.evaluatorId);
                  return (
                    <Table.Row key={row.id}>
                      <Table.Cell>
                        <VStack align="start" gap={0}>
                          <Text fontSize="sm" fontWeight="medium">
                            {row.name}
                          </Text>
                          {row.description && (
                            <Text fontSize="xs" color="fg.muted">
                              {row.description}
                            </Text>
                          )}
                        </VStack>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge variant="subtle">
                          {DIRECTION_LABEL[row.direction]}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        {evaluator ? (
                          <VStack align="start" gap={0}>
                            <Text fontSize="sm">{evaluator.name}</Text>
                            <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
                              {evaluator.slug}
                            </Text>
                          </VStack>
                        ) : (
                          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                            {row.evaluatorId}
                          </Text>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Badge
                          variant="surface"
                          colorPalette={
                            row.failureMode === "FAIL_CLOSED" ? "red" : "yellow"
                          }
                        >
                          {row.failureMode === "FAIL_CLOSED"
                            ? "fail closed"
                            : "fail open"}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <HStack justify="end" gap={1}>
                          {canManage && (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setEditing(row)}
                            >
                              <Pencil size={12} /> Edit
                            </Button>
                          )}
                          {canManage && (
                            <Button
                              size="xs"
                              variant="ghost"
                              colorPalette="red"
                              onClick={() => setArchiving(row)}
                            >
                              <Archive size={12} />
                            </Button>
                          )}
                        </HStack>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          )}
        </VStack>
      </Box>

      <GuardrailDrawer
        open={createOpen || editing !== null}
        mode={editing ? "edit" : "create"}
        existing={editing}
        projectId={projectId}
        guardrailEvaluators={guardrailEvaluators}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={`Archive guardrail "${archiving?.name ?? ""}"?`}
        message="The guardrail stops being evaluated on the gateway within ~60s. VKs that referenced it via guardrailAttachments will simply skip it on next bundle refresh."
        confirmLabel="Archive"
        tone="danger"
        loading={archiveMutation.isPending}
        onConfirm={confirmArchive}
      />
    </AiGatewayLayout>
  );
}

function GuardrailDrawer({
  open,
  mode,
  existing,
  projectId,
  guardrailEvaluators,
  onClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  existing: GuardrailRow | null;
  projectId: string;
  guardrailEvaluators: Array<{ id: string; name: string; slug: string }>;
  onClose: () => void;
}) {
  const utils = api.useContext();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [evaluatorId, setEvaluatorId] = useState("");
  const [direction, setDirection] =
    useState<GatewayGuardrailDirection>("PRE");
  const [failureMode, setFailureMode] =
    useState<GatewayGuardrailFailureMode>("FAIL_CLOSED");

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && existing) {
      setName(existing.name);
      setDescription(existing.description ?? "");
      setEvaluatorId(existing.evaluatorId);
      setDirection(existing.direction);
      setFailureMode(existing.failureMode);
    } else if (mode === "create") {
      setName("");
      setDescription("");
      setEvaluatorId(guardrailEvaluators[0]?.id ?? "");
      setDirection("PRE");
      setFailureMode("FAIL_CLOSED");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, existing?.id]);

  const createMutation = api.gatewayGuardrails.create.useMutation({
    onSuccess: async () => {
      await utils.gatewayGuardrails.list.invalidate({ projectId });
      onClose();
    },
    onError: (err) =>
      toaster.create({ title: err.message, type: "error" }),
  });
  const updateMutation = api.gatewayGuardrails.update.useMutation({
    onSuccess: async () => {
      await utils.gatewayGuardrails.list.invalidate({ projectId });
      onClose();
    },
    onError: (err) =>
      toaster.create({ title: err.message, type: "error" }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const submitDisabled = !name.trim() || !evaluatorId || isPending;

  const submit = () => {
    if (mode === "create") {
      createMutation.mutate({
        projectId,
        name,
        description: description || null,
        evaluatorId,
        direction,
        failureMode,
      });
    } else if (existing) {
      updateMutation.mutate({
        projectId,
        id: existing.id,
        name,
        description: description || null,
        evaluatorId,
        direction,
        failureMode,
      });
    }
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next) onClose();
      }}
      placement="end"
      size="md"
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>
            {mode === "create" ? "New guardrail" : "Edit guardrail"}
          </Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={5}>
            <Field.Root required>
              <Field.Label>Name</Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. block PII on requests"
                autoFocus
              />
            </Field.Root>

            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Why this guardrail exists"
              />
            </Field.Root>

            <Field.Root required>
              <Field.Label>Evaluator</Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={evaluatorId}
                  onChange={(e) => setEvaluatorId(e.target.value)}
                >
                  <option value="">Pick an evaluator…</option>
                  {guardrailEvaluators.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.slug})
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
              <Field.HelperText>
                Only evaluators with executionMode AS_GUARDRAIL are listed.
                Flip an evaluator in Evaluations to expose it here.
              </Field.HelperText>
            </Field.Root>

            <Field.Root required>
              <Field.Label>Direction</Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={direction}
                  onChange={(e) =>
                    setDirection(
                      e.target.value as GatewayGuardrailDirection,
                    )
                  }
                >
                  {(["PRE", "POST", "STREAM_CHUNK"] as const).map((d) => (
                    <option key={d} value={d}>
                      {DIRECTION_LABEL[d]}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
              <Field.HelperText>{DIRECTION_HELP[direction]}</Field.HelperText>
            </Field.Root>

            <Field.Root required>
              <Field.Label>Failure mode</Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={failureMode}
                  onChange={(e) =>
                    setFailureMode(
                      e.target.value as GatewayGuardrailFailureMode,
                    )
                  }
                >
                  <option value="FAIL_CLOSED">
                    {FAILURE_LABEL.FAIL_CLOSED}
                  </option>
                  <option value="FAIL_OPEN">{FAILURE_LABEL.FAIL_OPEN}</option>
                </NativeSelect.Field>
              </NativeSelect.Root>
              <Field.HelperText>
                stream_chunk is always fail-open per contract regardless of
                this setting.
              </Field.HelperText>
            </Field.Root>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              onClick={submit}
              loading={isPending}
              disabled={submitDisabled}
            >
              {mode === "create" ? "Create" : "Save changes"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

export default withPermissionGuard("gatewayGuardrails:view", {
  layoutComponent: AiGatewayLayout,
})(GuardrailsPage);
