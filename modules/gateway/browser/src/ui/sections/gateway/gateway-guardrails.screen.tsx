import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Drawer } from "@langwatch/design-system/drawer";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Badge,
  Button,
  Field,
  Input,
  NativeSelect,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type {
  GatewayGuardrailDirection,
  GatewayGuardrailFailureMode,
} from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";
import { Archive, MoreVertical, Pencil, Plus, Shield } from "lucide-react";
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from "react";

import { api } from "../../../behavior/gateway-api.ts";
import { useShowErrorToast } from "../../../behavior/gateway-feedback.ts";
import { useOrganizationTeamProject } from "../../../behavior/gateway-session.ts";
import { useGatewayHost } from "../../../model/gateway-host.ts";
import { Link } from "../../../ui/elements/gateway-link.tsx";
import AiGatewayLayout from "../../../ui/sections/gateway-layout.tsx";
import { ListSkeleton } from "../../elements/list-skeleton.tsx";

type GuardrailRow = {
  id: string;
  name: string;
  description: string | null;
  evaluatorId: string;
  direction: GatewayGuardrailDirection;
  failureMode: GatewayGuardrailFailureMode;
  archivedAt: string | Instant | null;
  createdAt: string | Instant;
  updatedAt: string | Instant;
};

const DIRECTION_LABEL: Record<GatewayGuardrailDirection, string> = {
  PRE: "Pre (request)",
  POST: "Post (response)",
  STREAM_CHUNK: "Stream chunk",
};

const DIRECTION_HELP: Record<GatewayGuardrailDirection, string> = {
  PRE: "Runs on the inbound request body before any provider call. Block returns 403 guardrail_blocked.",
  POST: "Runs on the assistant response before the client sees it. Block returns 403 + zero-cost debit.",
  STREAM_CHUNK: "Runs per visible SSE delta. Always fail-open per contract (50ms budget).",
};

const FAILURE_LABEL: Record<GatewayGuardrailFailureMode, string> = {
  FAIL_CLOSED: "Fail closed (block on evaluator error)",
  FAIL_OPEN: "Fail open (allow on evaluator error)",
};

function GuardrailsPage() {
  const showErrorToast = useShowErrorToast();
  const { organization, project } = useOrganizationTeamProject();
  const host = useGatewayHost();
  const projectId = project?.id ?? "";
  const canManage = host.hasPermission("gatewayGuardrails:manage");

  const listQuery = api.gatewayGuardrails.list.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();
  const guardrailEvaluators = useGuardrailEvaluators({ projectId });
  const evaluatorById = (() => {
    const map = new Map<string, GuardrailEvaluator>();
    for (const e of guardrailEvaluators) {
      map.set(e.id, e);
    }
    return map;
  })();

  const archiveMutation = api.gatewayGuardrails.archive.useMutation({
    onSuccess: async () => {
      if (projectId) {
        await utils.gatewayGuardrails.list.invalidate({ projectId });
      }
    },
  });

  const openGuardrail = (row?: GuardrailRow) =>
    host.openDrawer({
      drawer: "gatewayGuardrail",
      ...(row ? { params: { guardrailId: row.id } } : {}),
    });
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
      showErrorToast({
        error,
        fallbackTitle: "Couldn't archive the guardrail",
      });
    }
  };

  const rows = (listQuery.data ?? []) as GuardrailRow[];
  const activeRows = rows.filter((r) => !r.archivedAt);

  if (!organization) {
    return (
      <AiGatewayLayout>
        <PageLayout.Container>
          <ListSkeleton />
        </PageLayout.Container>
      </AiGatewayLayout>
    );
  }
  if (!projectId) {
    return (
      <AiGatewayLayout pageTitle="Guardrails · AI Gateway · LangWatch">
        <PageLayout.Header>
          <PageLayout.Heading>Guardrails</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <NoDataInfoBlock
            title="Pick a project first"
            description="Guardrails are scoped per project. Use the project switcher in the top-left to pick a project before creating one."
            icon={<Shield size={36} />}
          />
        </PageLayout.Container>
      </AiGatewayLayout>
    );
  }

  const isLoadingGuardrails = listQuery.isLoading;
  const showGuardrailsEmpty = !isLoadingGuardrails && activeRows.length === 0;
  const showGuardrails = !isLoadingGuardrails && activeRows.length !== 0;

  return (
    <AiGatewayLayout pageTitle="Guardrails · AI Gateway · LangWatch">
      <PageLayout.Header>
        <PageLayout.Heading>Guardrails</PageLayout.Heading>
        <Spacer />
        {canManage && (
          <Tooltip
            content="Add an evaluator that runs as a guardrail first, then you can create guardrails from it."
            disabled={guardrailEvaluators.length > 0}
          >
            <span>
              <PageLayout.HeaderButton
                primary
                data-testid="gateway-guardrail-new"
                onClick={() => openGuardrail()}
                disabled={guardrailEvaluators.length === 0}
              >
                <Plus size={14} /> New guardrail
              </PageLayout.HeaderButton>
            </span>
          </Tooltip>
        )}
      </PageLayout.Header>

      <PageLayout.Container>
        <VStack align="stretch" gap={6}>
          <Text color="fg.muted">
            Check what goes into and comes out of your models, using this project's evaluators on
            every gateway request.
          </Text>

          {isLoadingGuardrails && <ListSkeleton />}
          {showGuardrailsEmpty && (
            <GuardrailsEmptyState
              hasGuardrailEvaluators={guardrailEvaluators.length > 0}
              evaluatorsHref={project?.slug ? `/${project.slug}/evaluators` : undefined}
            />
          )}
          {showGuardrails && (
            <GuardrailsTable
              rows={activeRows}
              evaluatorById={evaluatorById}
              canManage={canManage}
              onEdit={openGuardrail}
              onArchive={setArchiving}
            />
          )}
        </VStack>
      </PageLayout.Container>

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={`Archive guardrail "${archiving?.name ?? ""}"?`}
        message="The guardrail stops running on gateway requests within about a minute. Virtual keys that use it will simply skip it from then on."
        confirmLabel="Archive"
        tone="danger"
        loading={archiveMutation.isPending}
        onConfirm={confirmArchive}
      />
    </AiGatewayLayout>
  );
}

function GuardrailsEmptyState({
  hasGuardrailEvaluators,
  evaluatorsHref,
}: {
  hasGuardrailEvaluators: boolean;
  evaluatorsHref: string | undefined;
}) {
  return (
    <NoDataInfoBlock
      title="No guardrails yet"
      description={
        hasGuardrailEvaluators
          ? "Choose New guardrail to run one of your evaluators on requests, responses or both."
          : "None of your evaluators can run as a guardrail yet. Open an evaluator and set it to run as a guardrail, then come back to use it here."
      }
      icon={<Shield size={36} />}
      secondaryAction={
        evaluatorsHref ? <Link href={evaluatorsHref}>Go to evaluators</Link> : undefined
      }
    />
  );
}

type GuardrailEvaluator = { id: string; name: string; slug: string };

function GuardrailsTable({
  rows,
  evaluatorById,
  canManage,
  onEdit,
  onArchive,
}: {
  rows: GuardrailRow[];
  evaluatorById: Map<string, GuardrailEvaluator>;
  canManage: boolean;
  onEdit: (row: GuardrailRow) => void;
  onArchive: (row: GuardrailRow) => void;
}) {
  return (
    <ListTable scroll="x" scrollLabel="Guardrails table">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Direction</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Evaluator</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Failure mode</ListTable.ColumnHeader>
          <ListTable.ColumnHeader label="Actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {rows.map((row) => {
          const evaluator = evaluatorById.get(row.evaluatorId);
          return (
            <ListTable.Row key={row.id} data-testid="gateway-guardrail-row">
              <ListTable.Cell>
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
              </ListTable.Cell>
              <ListTable.Cell>
                <Badge variant="subtle">{DIRECTION_LABEL[row.direction]}</Badge>
              </ListTable.Cell>
              <ListTable.Cell>
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
              </ListTable.Cell>
              <ListTable.Cell>
                <Badge
                  variant="surface"
                  colorPalette={row.failureMode === "FAIL_CLOSED" ? "red" : "yellow"}
                >
                  {row.failureMode === "FAIL_CLOSED" ? "Fail closed" : "Fail open"}
                </Badge>
              </ListTable.Cell>
              <ListTable.Cell>
                {canManage && (
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <Button size="xs" variant="ghost" aria-label={`Actions for ${row.name}`}>
                        <MoreVertical size={14} />
                      </Button>
                    </Menu.Trigger>
                    <Menu.Content>
                      <Menu.Item
                        value="edit"
                        data-testid="gateway-guardrail-edit"
                        onClick={() => onEdit(row)}
                      >
                        <Pencil size={14} /> Edit
                      </Menu.Item>
                      <Menu.Item
                        value="archive"
                        color="fg.error"
                        data-testid="gateway-guardrail-archive"
                        onClick={() => onArchive(row)}
                      >
                        <Archive size={14} /> Archive
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Root>
                )}
              </ListTable.Cell>
            </ListTable.Row>
          );
        })}
      </ListTable.Body>
    </ListTable>
  );
}

/** The guardrail editor, opened by address; `drawer.guardrailId` names the one to edit. */
export function GuardrailDrawer({
  guardrailId,
  onClose,
}: {
  guardrailId?: string;
  onClose: () => void;
}) {
  const showErrorToast = useShowErrorToast();
  const utils = api.useUtils();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const listQuery = api.gatewayGuardrails.list.useQuery(
    { projectId },
    { enabled: !!projectId && !!guardrailId, refetchOnWindowFocus: false },
  );
  const existing = listQuery.data?.find((r) => r.id === guardrailId) ?? null;
  const mode = guardrailId ? "edit" : "create";
  const guardrailEvaluators = useGuardrailEvaluators({ projectId });
  const defaultEvaluatorId = guardrailEvaluators[0]?.id ?? "";
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [evaluatorId, setEvaluatorId] = useState("");
  const [direction, setDirection] = useState<GatewayGuardrailDirection>("PRE");
  const [failureMode, setFailureMode] = useState<GatewayGuardrailFailureMode>("FAIL_CLOSED");
  const [attempted, setAttempted] = useState(false);
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const evaluatorRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setAttempted(false);
    if (mode === "edit" && existing) {
      setName(existing.name);
      setDescription(existing.description ?? "");
      setEvaluatorId(existing.evaluatorId);
      setDirection(existing.direction);
      setFailureMode(existing.failureMode);
    } else if (mode === "create") {
      setName("");
      setDescription("");
      setEvaluatorId(defaultEvaluatorId);
      setDirection("PRE");
      setFailureMode("FAIL_CLOSED");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, existing?.id, defaultEvaluatorId]);

  const createMutation = api.gatewayGuardrails.create.useMutation({
    onSuccess: async () => {
      await utils.gatewayGuardrails.list.invalidate({ projectId });
      onClose();
    },
    onError: (err) =>
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't create the guardrail",
      }),
  });
  const updateMutation = api.gatewayGuardrails.update.useMutation({
    onSuccess: async () => {
      await utils.gatewayGuardrails.list.invalidate({ projectId });
      onClose();
    },
    onError: (err) =>
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't save the guardrail",
      }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const nameMissing = !name.trim();
  const evaluatorMissing = !evaluatorId;
  const editingUnavailable = mode === "edit" && !existing;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending || editingUnavailable) return;
    setAttempted(true);
    const invalid = firstInvalidField({
      nameMissing,
      evaluatorMissing,
      nameRef,
      evaluatorRef,
    });
    if (invalid) {
      invalid.focus();
      return;
    }
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
    <Drawer
      open
      onClose={onClose}
      size="md"
      title={mode === "create" ? "New guardrail" : "Edit guardrail"}
      loading={mode === "edit" && listQuery.isLoading}
      error={editError({ mode, listQuery, existing })}
      footer={{
        cancel: { onClick: onClose },
        busy: isPending,
        ...(editingUnavailable
          ? {}
          : {
              primaryAction: {
                label: mode === "create" ? "Create" : "Save changes",
                type: "submit" as const,
                form: formId,
                loading: isPending,
                "data-testid": "gateway-guardrail-submit",
              },
            }),
      }}
    >
      <form id={formId} noValidate onSubmit={submit}>
        <VStack align="stretch" gap={5}>
          <Field.Root required invalid={attempted && nameMissing}>
            <Field.Label>Name</Field.Label>
            <Input
              ref={nameRef}
              data-testid="gateway-guardrail-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. block PII on requests"
            />
            <Field.ErrorText>Enter a name.</Field.ErrorText>
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

          <Field.Root required invalid={attempted && evaluatorMissing}>
            <Field.Label>Evaluator</Field.Label>
            <NativeSelect.Root size="sm">
              <NativeSelect.Field
                ref={evaluatorRef}
                data-testid="gateway-guardrail-evaluator"
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
              Only evaluators with executionMode AS_GUARDRAIL are listed. Flip an evaluator in
              Evaluations to expose it here.
            </Field.HelperText>
            <Field.ErrorText>Choose an evaluator.</Field.ErrorText>
          </Field.Root>

          <Field.Root required>
            <Field.Label>Direction</Field.Label>
            <NativeSelect.Root size="sm">
              <NativeSelect.Field
                data-testid="gateway-guardrail-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as GatewayGuardrailDirection)}
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
                onChange={(e) => setFailureMode(e.target.value as GatewayGuardrailFailureMode)}
              >
                <option value="FAIL_CLOSED">{FAILURE_LABEL.FAIL_CLOSED}</option>
                <option value="FAIL_OPEN">{FAILURE_LABEL.FAIL_OPEN}</option>
              </NativeSelect.Field>
            </NativeSelect.Root>
            <Field.HelperText>
              stream_chunk is always fail-open per contract regardless of this setting.
            </Field.HelperText>
          </Field.Root>
        </VStack>
      </form>
    </Drawer>
  );
}

/** The first field a save attempt must fix, in the order the form shows them. */
function firstInvalidField({
  nameMissing,
  evaluatorMissing,
  nameRef,
  evaluatorRef,
}: {
  nameMissing: boolean;
  evaluatorMissing: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  evaluatorRef: RefObject<HTMLSelectElement | null>;
}) {
  if (nameMissing) return nameRef.current;
  if (evaluatorMissing) return evaluatorRef.current;
  return null;
}

/** Why an edit has nothing to edit yet: the list failed, or the row is gone. */
function editError({
  mode,
  listQuery,
  existing,
}: {
  mode: "create" | "edit";
  listQuery: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  existing: unknown;
}) {
  if (mode !== "edit" || listQuery.isLoading || existing) return undefined;
  if (listQuery.isError) {
    return {
      title: "Couldn't load this guardrail",
      onRetry: () => void listQuery.refetch(),
    };
  }
  return { title: "This guardrail is no longer available" };
}

export default GuardrailsPage;

/**
 * executionMode AS_GUARDRAIL lives on Monitor (not Evaluator). A guardrail-eligible binding is
 * an enabled Monitor with a non-null evaluatorId: the FK GatewayGuardrail.evaluatorId points at.
 */
function useGuardrailEvaluators({ projectId }: { projectId: string }) {
  const monitorsQuery = api.monitors.getAllForProject.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );
  return (monitorsQuery.data ?? [])
    .filter(
      (m) =>
        m.enabled &&
        m.executionMode === "AS_GUARDRAIL" &&
        typeof m.evaluatorId === "string" &&
        m.evaluatorId.length > 0,
    )
    .map((m) => ({
      id: m.evaluatorId as string,
      name: m.name as string,
      slug: m.slug as string,
    }));
}
