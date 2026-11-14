/**
 * New braid and Edit braid: the project it starts from fixed, the picker, the condition checked
 * as it is typed, only signed calls, the window, and what the reader will see before it is saved.
 * Spec: modules/authz/specs/braids-screen.feature (design: dev/docs/plans/braids/, step 3).
 */

import { type AuthzBraid, BRAID_TARGETS_LIMIT } from "@langwatch/authz-contract";
import { Banner } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Grid, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { nowInstant } from "@langwatch/time";
import { Info } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import {
  useBraidPreview,
  useBraidTargets,
  useBraidTestTrace,
  useConditionCheck,
  useOwnerAttributeKeys,
  useReaderSigning,
  useSaveBraid,
  useTraceViewers,
} from "../../../behavior/use-braid-dialog.ts";
import { useAuthzHost } from "../../../model/authz-host.ts";
import {
  type BraidDraft,
  braidDraftChanged,
  braidDraftOf,
  braidsOnPair,
  braidDraftReady,
  braidTargetOptions,
  expiresAtMsOf,
  newBraidDraft,
  signedEntryKey,
  testTraceRows,
  verifiedKeyIn,
  viewersPhrase,
  withSignedCalls,
} from "../../../model/braids/braid-draft.ts";
import { braidProject, braidsSigningKeysHref } from "../../../model/braids/braids.ts";
import { BraidConditionField } from "../../blocks/braids/dialog/braid-condition-field.tsx";
import {
  BraidPreviewPanel,
  type BraidPreviewPanelProps,
} from "../../blocks/braids/dialog/braid-preview-panel.tsx";
import { BraidRouteFields } from "../../blocks/braids/dialog/braid-route-fields.tsx";
import {
  BraidSignedCalls,
  type ReaderSigning,
} from "../../blocks/braids/dialog/braid-signed-calls.tsx";
import type { TestTraceProps } from "../../blocks/braids/dialog/braid-trace-tree.tsx";
import { BraidWindowFields } from "../../blocks/braids/dialog/braid-window-fields.tsx";

export type BraidDialogProps = {
  projectId: string;
  /** The braid Edit opened; absent for New braid. */
  editing: AuthzBraid | undefined;
  /** This project's braids into others, so the dialog says what a reader already sees. */
  braidsInto: readonly AuthzBraid[];
  /** The organisation keeps braids to its admins, so only they can remove one. */
  keptToAdmins: boolean;
  onClose: () => void;
};

function signingOf(signing: ReturnType<typeof useReaderSigning>): ReaderSigning {
  if (signing.isLoading) return { state: "loading" };
  if (signing.isError || signing.data === undefined) return { state: "unknown" };
  return signing.data
    ? { state: "signs", keyName: signing.data.keyName, lastUsedAt: signing.data.lastUsedAt }
    : { state: "none" };
}

function previewStateOf({
  hasReader,
  conditionOk,
  refusalShown,
  preview,
}: {
  hasReader: boolean;
  conditionOk: boolean;
  refusalShown: boolean;
  preview: ReturnType<typeof useBraidPreview>;
}): BraidPreviewPanelProps["preview"] {
  if (!hasReader) return { state: "no-reader" };
  if (refusalShown || preview.data?.refusal) return { state: "refused" };
  if (!conditionOk) return { state: "loading" };
  if (preview.isError) return { state: "error" };
  if (!preview.data || preview.isSettling) return { state: "loading" };
  const { live, spans, example } = preview.data;
  return {
    state: "ready",
    traces: preview.data.traces,
    unsignedHidden: preview.data.unsignedHidden,
    added: live.braids > 0 ? { spans: Math.max(0, spans - live.spans), braids: live.braids } : null,
    example: example ? testTraceRows(example.nodes) : null,
  };
}

/** The test query never runs without a reader or under a refused condition: neither waits on it. */
function testStateOf({
  traceId,
  tested,
  hasReader,
  conditionOk,
}: {
  traceId: string | undefined;
  tested: ReturnType<typeof useBraidTestTrace>;
  hasReader: boolean;
  conditionOk: boolean;
}): TestTraceProps["test"] {
  if (!hasReader) return { state: "blocked", reason: "Pick a project to braid into first." };
  if (!conditionOk) return { state: "blocked", reason: "Fix the condition to test a trace." };
  if (!traceId) return { state: "idle" };
  if (tested.isError) return { state: "error" };
  if (!tested.data) return { state: "loading" };
  if (!tested.data.found) return { state: "not-found" };
  return { state: "ready", rows: testTraceRows(tested.data.nodes) };
}

/** Why Save is not offered yet, said on the button. */
function saveBlockedReason({
  hasReader,
  conditionOk,
  draft,
  nowMs,
}: {
  hasReader: boolean;
  conditionOk: boolean;
  draft: BraidDraft;
  nowMs: number;
}): string {
  if (!hasReader) return "Pick a project to braid into first";
  if (!conditionOk) return "Fix the condition first";
  const expiresAtMs = expiresAtMsOf({ ends: draft.ends, nowMs });
  if (expiresAtMs !== undefined && expiresAtMs <= nowMs) return "Pick an end after today";
  return "Change the braid to save it";
}

/** Side by side, each column scrolls on its own, so the form stays put while the preview grows. */
const COLUMN_SCROLL = {
  maxHeight: { lg: "full" },
  overflowY: { lg: "auto" },
  padding: 1,
  margin: -1,
} as const;

/** A group of the form under a heading a step above its field labels: Which spans, Active. */
function FieldGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Stack as="section" gap={3} aria-label={title}>
      <Stack gap={0.5}>
        <Text as="h3" textStyle="cardTitle">
          {title}
        </Text>
        {hint ? (
          <Text textStyle="bodySm" color="fg.muted">
            {hint}
          </Text>
        ) : null}
      </Stack>
      {children}
    </Stack>
  );
}

export function BraidDialog({
  projectId,
  editing,
  braidsInto,
  keptToAdmins,
  onClose,
}: BraidDialogProps) {
  const host = useAuthzHost();
  const { projects } = host.organizationStructure();
  const [nowMs] = useState(() => nowInstant().epochMilliseconds);
  const [draft, setDraft] = useState<BraidDraft>(() =>
    editing ? braidDraftOf(editing) : newBraidDraft({ nowMs }),
  );
  const [testedTraceId, setTestedTraceId] = useState<string>();
  // New braid opens on Into, Edit (Into fixed) on the condition: never on the locked From.
  const intoTrigger = useRef<HTMLButtonElement>(null);
  const change = (next: Partial<BraidDraft>) => setDraft((current) => ({ ...current, ...next }));

  const targetProjects = projects.slice(0, BRAID_TARGETS_LIMIT);
  const targets = useBraidTargets({
    projectId,
    projectIds: targetProjects.map((project) => project.id),
  });
  const attributeKeys = useOwnerAttributeKeys({ projectId });
  const signing = useReaderSigning({ readerProjectId: draft.readerProjectId });
  const viewers = useTraceViewers({ readerProjectId: draft.readerProjectId });
  const preview = useBraidPreview({ projectId, draft, braidId: editing?.braidId });
  const tested = useBraidTestTrace({
    projectId,
    draft,
    traceId: testedTraceId,
    braidId: editing?.braidId,
  });
  const save = useSaveBraid({ projectId, braidId: editing?.braidId, onSaved: onClose });

  const owner = braidProject({ projectId, projects });
  const reader = draft.readerProjectId
    ? braidProject({ projectId: draft.readerProjectId, projects })
    : undefined;
  const readerSlug = projects.find((project) => project.id === draft.readerProjectId)?.slug;
  const onPair = braidsOnPair({
    braids: braidsInto,
    readerProjectId: draft.readerProjectId,
    editingBraidId: editing?.braidId,
    nowMs,
  });
  const { options, someLeftOut } = braidTargetOptions({
    projects: targetProjects,
    targets: targets.data ?? [],
  });
  // `check` blocks Save and Test as typed; the preview says refused only once it has settled.
  const { check, shown, settle } = useConditionCheck(draft.where);
  const verifiedKey = verifiedKeyIn(draft.where);
  const entryKey =
    verifiedKey ?? signedEntryKey({ where: draft.where, readerName: reader?.name ?? "" });
  const setSignedCalls = (on: boolean) =>
    change({ where: withSignedCalls({ where: draft.where, on, key: entryKey }) });

  const previewState = previewStateOf({
    hasReader: !!reader,
    conditionOk: check.ok,
    refusalShown: !shown.ok,
    preview,
  });
  const testState = testStateOf({
    traceId: testedTraceId,
    tested,
    hasReader: !!reader,
    conditionOk: check.ok,
  });
  const disabledReason = saveBlockedReason({
    hasReader: !!reader,
    conditionOk: check.ok,
    draft,
    nowMs,
  });
  const unchanged = !!editing && !braidDraftChanged({ draft, braid: editing, nowMs });
  const ready = braidDraftReady({ draft, nowMs }) && !unchanged;

  return (
    <Dialog
      open
      onClose={onClose}
      size="document"
      title={editing ? "Edit braid" : "New braid"}
      description="Show this project's matching spans inside another project's traces. Nothing is copied."
      busy={save.isSaving}
      bodyScroll="content"
      initialFocusEl={() => (editing ? null : intoTrigger.current)}
      note={
        <HStack gap={1.5} color="fg.muted" textStyle="xs">
          <Info size={12} aria-hidden />
          <Text>
            {keptToAdmins
              ? "Organisation admins can remove a braid at any time."
              : "Admins of either project can remove a braid at any time."}
          </Text>
        </HStack>
      }
      primaryAction={{
        label: editing ? "Save braid" : `Braid into ${reader?.name ?? "a project"}`,
        onClick: () => save.save({ draft, nowMs }),
        loading: save.isSaving,
        ...(ready ? {} : { disabledReason }),
        "data-testid": "braid-save",
      }}
    >
      <Grid
        templateColumns={{ base: "1fr", lg: "minmax(0, 1.4fr) minmax(0, 1fr)" }}
        gap={8}
        alignItems="start"
        flex={1}
        minHeight={0}
        overflowY={{ base: "auto", lg: "hidden" }}
        height={{ lg: "full" }}
      >
        <Stack gap={7} {...COLUMN_SCROLL}>
          {save.refusal ? (
            <Banner status="error" title="The braid wasn't saved">
              {save.refusal}
            </Banner>
          ) : null}
          <BraidRouteFields
            owner={owner}
            reader={reader}
            options={options}
            someLeftOut={someLeftOut}
            listedOnly={projects.length > targetProjects.length ? targetProjects.length : undefined}
            isLoading={targets.isLoading}
            loadFailed={targets.isError}
            onRetry={() => void targets.refetch()}
            readerFixed={!!editing}
            onPick={(readerProjectId) => change({ readerProjectId })}
            intoRef={intoTrigger}
          />
          <FieldGroup
            title="Which spans"
            hint={`Which ${owner.name} spans ${reader?.name ?? "the other project"} sees. Left empty, all of them.`}
          >
            <BraidConditionField
              value={draft.where}
              onChange={(where) => change({ where })}
              check={shown}
              onSettle={settle}
              ownerName={owner.name}
              readerName={reader?.name ?? "the other project"}
              verified={verifiedKey !== undefined}
              attributeKeys={attributeKeys.data?.keys ?? []}
              focusOnLoad={!!editing}
            >
              <BraidSignedCalls
                on={verifiedKey !== undefined}
                onChange={setSignedCalls}
                entryKey={entryKey}
                readerName={reader?.name}
                signing={signingOf(signing)}
                readerKeysHref={
                  readerSlug ? braidsSigningKeysHref({ projectSlug: readerSlug }) : undefined
                }
              />
            </BraidConditionField>
          </FieldGroup>
          <FieldGroup title="Active">
            <BraidWindowFields
              fromMs={draft.fromMs}
              ends={draft.ends}
              nowMs={nowMs}
              ownerName={owner.name}
              readerName={reader?.name ?? "the other project"}
              onFrom={(fromMs) => change({ fromMs })}
              onEnds={(ends) => change({ ends })}
            />
          </FieldGroup>
        </Stack>
        <Box {...COLUMN_SCROLL}>
          <Card variant="nested">
            <BraidPreviewPanel
              ownerName={owner.name}
              readerName={reader?.name}
              preview={previewState}
              unsignedWarning={
                !!reader &&
                check.ok &&
                /\battributes\s*\[/.test(draft.where) &&
                verifiedKey === undefined
              }
              onSignedCalls={() => setSignedCalls(true)}
              viewers={viewers.data ? viewersPhrase(viewers.data) : undefined}
              pairBraids={reader ? onPair : []}
              test={testState}
              onTest={setTestedTraceId}
            />
          </Card>
        </Box>
      </Grid>
    </Dialog>
  );
}
