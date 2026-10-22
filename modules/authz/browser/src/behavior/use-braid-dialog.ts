// The braid dialog's reads and its one write. A refusal the person can act on is said in the
// drawer; anything else goes to the host's failure notice. Spec: braids-screen.feature.

import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { traceClient } from "@langwatch/trace-client";
import { useEffect, useState } from "react";

import { useAuthzHost } from "../model/authz-host.ts";
import { type BraidDraft, checkCondition, expiresAtMsOf } from "../model/braids/braid-draft.ts";
import { authzApi } from "./authz-api.ts";

/** How long typing pauses before the preview asks again. */
export const BRAID_PREVIEW_DEBOUNCE_MS = 400;

/** The value once it has held still for `delayMs`; a key string, so equal drafts do not re-ask. */
export function useSettled<T>({ value, key, delayMs }: { value: T; key: string; delayMs: number }) {
  const [settled, setSettled] = useState({ key, value });
  useEffect(() => {
    if (key === settled.key) return;
    const timer = setTimeout(() => setSettled({ key, value }), delayMs);
    return () => clearTimeout(timer);
  }, [key, value, delayMs, settled.key]);
  return settled.value;
}

export function useBraidTargets({
  projectId,
  projectIds,
}: {
  projectId: string;
  projectIds: string[];
}) {
  return authzApi.authz.listBraidTargets.useQuery(
    { projectId, projectIds },
    { enabled: projectIds.length > 0, retry: false },
  );
}

export function useTraceViewers({ readerProjectId }: { readerProjectId: string | undefined }) {
  return authzApi.authz.countProjectTraceViewers.useQuery(
    { projectId: readerProjectId ?? "" },
    { enabled: !!readerProjectId, retry: false },
  );
}

export function useReaderSigningKeys({ readerProjectId }: { readerProjectId: string | undefined }) {
  return authzApi.signingKeys.list.useQuery(
    { projectId: readerProjectId ?? "" },
    { enabled: !!readerProjectId, retry: false },
  );
}

export function useOwnerAttributeKeys({ projectId }: { projectId: string }) {
  return traceClient.traces.braidAttributeKeys.useQuery({ projectId }, { retry: false });
}

/**
 * The preview of the draft once typing settles; not asked while the condition is refused. An
 * edited braid is named, so the preview counts the draft in its place rather than beside it.
 */
export function useBraidPreview({
  projectId,
  draft,
  braidId,
}: {
  projectId: string;
  draft: BraidDraft;
  braidId: string | undefined;
}) {
  const asked = {
    projectId,
    readerProjectId: draft.readerProjectId ?? "",
    where: draft.where,
    fromMs: draft.fromMs,
    ...(braidId ? { braidId } : {}),
  };
  const settled = useSettled({
    value: asked,
    key: JSON.stringify(asked),
    delayMs: BRAID_PREVIEW_DEBOUNCE_MS,
  });
  const where = settled.where.trim();
  const query = traceClient.traces.braidPreview.useQuery(
    { ...settled, ...(where ? { where } : { where: undefined }) },
    {
      enabled: !!settled.readerProjectId && checkCondition(settled.where).ok,
      retry: false,
    },
  );
  return { ...query, isSettling: JSON.stringify(asked) !== JSON.stringify(settled) };
}

/**
 * One trace as the reader would see it with the pair's live braids and the draft; asked only when
 * a trace id is tested. An edited braid is named, so the draft is read in its place.
 */
export function useBraidTestTrace({
  projectId,
  draft,
  traceId,
  braidId,
}: {
  projectId: string;
  draft: BraidDraft;
  traceId: string | undefined;
  braidId: string | undefined;
}) {
  const where = draft.where.trim();
  return traceClient.traces.braidTestTrace.useQuery(
    {
      projectId,
      readerProjectId: draft.readerProjectId ?? "",
      fromMs: draft.fromMs,
      traceId: traceId ?? "",
      ...(where ? { where } : {}),
      ...(braidId ? { braidId } : {}),
    },
    {
      enabled: !!traceId && !!draft.readerProjectId && checkCondition(draft.where).ok,
      retry: false,
    },
  );
}

/** What the drawer says for each refusal the person can act on; the rest is a failure notice. */
const SAVE_REFUSALS: Readonly<Record<string, string>> = {
  braid_already_exists: "A braid with these terms already goes into this project.",
  braid_changed: "This braid changed or was removed since you opened it. Close and open it again.",
  braid_into_itself: "A project can't braid into itself. Pick another project.",
  braid_aggregate_project: "Aggregate projects can't be braided. Pick a plain project.",
  braid_governance_project: "This project can't be braided. Pick another project.",
  braid_across_organizations: "Both projects must be in the same organisation.",
  braid_condition_syntax: "The condition can't be read. Check it and try again.",
  braid_condition_unsupported: "The condition uses something braids don't support yet.",
  braid_condition_too_large:
    "The condition is too long or has too many comparisons. Simplify it and try again.",
  braid_condition_limit_reached:
    "The project you're braiding into already receives the most different conditions it can. Reuse a condition one of its braids has, or remove a braid into it.",
  braid_not_on_project: "This braid is no longer on this project. Close and open it again.",
};

/** The terms a save sends; a relative end counts from when the drawer opened. */
function termsOf({
  projectId,
  draft,
  nowMs,
}: {
  projectId: string;
  draft: BraidDraft;
  nowMs: number;
}) {
  const where = draft.where.trim();
  const expiresAtMs = expiresAtMsOf({ ends: draft.ends, nowMs });
  return {
    projectId,
    readerProjectId: draft.readerProjectId ?? "",
    fromMs: draft.fromMs,
    ...(where ? { where } : {}),
    ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
  };
}

function refusalOf(error: unknown): string | undefined {
  const code = readHandledError(error)?.code;
  return code ? SAVE_REFUSALS[code] : undefined;
}

export function useSaveBraid({
  projectId,
  braidId,
  onSaved,
}: {
  projectId: string;
  braidId: string | undefined;
  onSaved: () => void;
}) {
  const host = useAuthzHost();
  const utils = authzApi.useUtils();
  const [refusal, setRefusal] = useState<string | null>(null);
  const handlers = {
    onSuccess: () => {
      void utils.authz.listBraids.invalidate();
      void utils.authz.listOrganizationBraids.invalidate();
      host.succeeded({
        title: braidId ? "Braid saved" : "Braid created",
        description: "The change is in the audit log.",
      });
      onSaved();
    },
    onError: (error: unknown) => {
      const said = refusalOf(error);
      if (said) setRefusal(said);
      else host.failed({ error, fallbackTitle: "Couldn't save the braid" });
    },
  };
  const creation = authzApi.authz.createBraid.useMutation(handlers);
  const change = authzApi.authz.changeBraid.useMutation(handlers);
  return {
    refusal,
    isSaving: creation.isPending || change.isPending,
    save: ({ draft, nowMs }: { draft: BraidDraft; nowMs: number }) => {
      if (!draft.readerProjectId) return;
      setRefusal(null);
      const terms = termsOf({ projectId, draft, nowMs });
      if (braidId) change.mutate({ ...terms, braidId });
      else creation.mutate(terms);
    },
  };
}
