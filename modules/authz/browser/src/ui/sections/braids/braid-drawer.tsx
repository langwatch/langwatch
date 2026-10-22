/**
 * New braid and Edit braid: the project it starts from fixed, the picker, the condition checked
 * as it is typed, only signed calls, the window, and what the reader will see before it is saved.
 * Spec: modules/authz/specs/braids-screen.feature (design: dev/docs/plans/braids/, step 3).
 */

import type { AuthzBraid } from "@langwatch/authz-contract";
import { Banner } from "@langwatch/design-system/banner";
import { Drawer } from "@langwatch/design-system/drawer";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { Grid, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { nowInstant } from "@langwatch/time";
import { Lock } from "lucide-react";
import { useState } from "react";

import {
  useBraidPreview,
  useBraidTargets,
  useBraidTestTrace,
  useOwnerAttributeKeys,
  useReaderSigningKeys,
  useSaveBraid,
  useTraceViewers,
} from "../../../behavior/use-braid-dialog.ts";
import { useAuthzHost } from "../../../model/authz-host.ts";
import {
  type BraidDraft,
  braidDraftOf,
  braidDraftReady,
  braidTargetOptions,
  checkCondition,
  expiresAtMsOf,
  newBraidDraft,
  signedEntryKey,
  testTraceRows,
  verifiedKeyIn,
  viewersPhrase,
  withSignedCalls,
} from "../../../model/braids/braid-draft.ts";
import { braidProject } from "../../../model/braids/braids.ts";
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
import { BraidWindowFields } from "../../blocks/braids/dialog/braid-window-fields.tsx";

export type BraidDrawerProps = {
  projectId: string;
  /** The braid Edit opened; absent for New braid. */
  editing: AuthzBraid | undefined;
  onClose: () => void;
};

function signingOf(keys: ReturnType<typeof useReaderSigningKeys>): ReaderSigning {
  if (keys.isLoading) return { state: "loading" };
  if (keys.isError || !keys.data) return { state: "unknown" };
  const live = keys.data
    .filter((key) => key.status !== "revoked")
    .toSorted((a, b) => String(b.lastUsedAt ?? "").localeCompare(String(a.lastUsedAt ?? "")));
  const key = live[0];
  return key
    ? { state: "signs", keyName: key.name, lastUsedAt: key.lastUsedAt }
    : { state: "none" };
}

function previewStateOf({
  hasReader,
  conditionOk,
  preview,
}: {
  hasReader: boolean;
  conditionOk: boolean;
  preview: ReturnType<typeof useBraidPreview>;
}): BraidPreviewPanelProps["preview"] {
  if (!hasReader) return { state: "no-reader" };
  if (!conditionOk || preview.data?.refusal) return { state: "refused" };
  if (preview.isError) return { state: "error" };
  if (!preview.data || preview.isSettling) return { state: "loading" };
  return {
    state: "ready",
    traces: preview.data.traces,
    unsignedHidden: preview.data.unsignedHidden,
  };
}

function testStateOf({
  traceId,
  tested,
}: {
  traceId: string | undefined;
  tested: ReturnType<typeof useBraidTestTrace>;
}): BraidPreviewPanelProps["test"] {
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
  return "Finish the braid first";
}

export function BraidDrawer({ projectId, editing, onClose }: BraidDrawerProps) {
  const host = useAuthzHost();
  const { projects } = host.organizationStructure();
  const [nowMs] = useState(() => nowInstant().epochMilliseconds);
  const [draft, setDraft] = useState<BraidDraft>(() =>
    editing ? braidDraftOf(editing) : newBraidDraft({ nowMs }),
  );
  const [testedTraceId, setTestedTraceId] = useState<string>();
  const change = (next: Partial<BraidDraft>) => setDraft((current) => ({ ...current, ...next }));

  const targets = useBraidTargets({ projectId, projectIds: projects.map((project) => project.id) });
  const attributeKeys = useOwnerAttributeKeys({ projectId });
  const signingKeys = useReaderSigningKeys({ readerProjectId: draft.readerProjectId });
  const viewers = useTraceViewers({ readerProjectId: draft.readerProjectId });
  const preview = useBraidPreview({ projectId, draft });
  const tested = useBraidTestTrace({ projectId, draft, traceId: testedTraceId });
  const save = useSaveBraid({ projectId, braidId: editing?.braidId, onSaved: onClose });

  const owner = braidProject({ projectId, projects });
  const reader = draft.readerProjectId
    ? braidProject({ projectId: draft.readerProjectId, projects })
    : undefined;
  const { options, someLeftOut } = braidTargetOptions({ projects, targets: targets.data ?? [] });
  const check = checkCondition(draft.where);
  const verifiedKey = verifiedKeyIn(draft.where);
  const entryKey =
    verifiedKey ?? signedEntryKey({ where: draft.where, readerName: reader?.name ?? "" });

  const previewState = previewStateOf({ hasReader: !!reader, conditionOk: check.ok, preview });
  const testState = testStateOf({ traceId: testedTraceId, tested });
  const disabledReason = saveBlockedReason({
    hasReader: !!reader,
    conditionOk: check.ok,
    draft,
    nowMs,
  });
  const ready = braidDraftReady({ draft, nowMs });

  return (
    <Drawer
      onClose={onClose}
      size="xl"
      icon={<FeatureMark feature="braids" size={20} />}
      title={editing ? "Edit braid" : "New braid"}
      subtitle="Show this project's matching spans inside another project's traces. Nothing is copied."
      busy={save.isSaving}
      footer={{
        note: (
          <HStack gap={1} color="fg.muted" fontSize="xs">
            <Lock size={12} aria-hidden />
            <Text>Admins of either project can remove a braid at any time.</Text>
          </HStack>
        ),
        cancel: { onClick: onClose },
        primaryAction: {
          label: editing ? "Save braid" : `Braid into ${reader?.name ?? "a project"}`,
          icon: <FeatureMark feature="braids" size={14} variant="mono" />,
          onClick: () => save.save({ draft, nowMs }),
          loading: save.isSaving,
          ...(ready ? {} : { disabledReason }),
          "data-testid": "braid-save",
        },
      }}
    >
      <Grid templateColumns={{ base: "1fr", lg: "minmax(0, 1.25fr) minmax(0, 1fr)" }} gap={6}>
        <Stack gap={5}>
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
            isLoading={targets.isLoading}
            readerFixed={!!editing}
            onPick={(readerProjectId) => change({ readerProjectId })}
          />
          <BraidConditionField
            value={draft.where}
            onChange={(where) => change({ where })}
            check={check}
            ownerName={owner.name}
            readerName={reader?.name ?? "the other project"}
            verified={verifiedKey !== undefined}
            attributeKeys={attributeKeys.data?.keys ?? []}
          />
          <BraidSignedCalls
            on={verifiedKey !== undefined}
            onChange={(on) =>
              change({ where: withSignedCalls({ where: draft.where, on, key: entryKey }) })
            }
            entryKey={entryKey}
            readerName={reader?.name}
            signing={signingOf(signingKeys)}
          />
          <BraidWindowFields
            fromMs={draft.fromMs}
            ends={draft.ends}
            nowMs={nowMs}
            ownerName={owner.name}
            readerName={reader?.name ?? "the other project"}
            onFrom={(fromMs) => change({ fromMs })}
            onEnds={(ends) => change({ ends })}
          />
        </Stack>
        <BraidPreviewPanel
          ownerName={owner.name}
          readerName={reader?.name}
          preview={previewState}
          unsignedWarning={
            !!reader && check.ok && draft.where.trim().length > 0 && verifiedKey === undefined
          }
          viewers={viewers.data ? viewersPhrase(viewers.data) : undefined}
          test={testState}
          onTest={setTestedTraceId}
        />
      </Grid>
    </Drawer>
  );
}
