import { useEffect, useRef, useState } from "react";

import {
  type ConversationTurn,
  lastTurnOfSession,
  openReplayHere,
  sayNothingWasStored,
} from "../model/open-replay.ts";
import { memberTenantOf } from "../model/session-identity.ts";
import { findSessionLink, sessionOfLink, withoutSessionLink } from "../model/session-link.ts";
import { codingAgentApi } from "./coding-agent-api.ts";
import { useCodingAgentToaster, useShowErrorToast } from "./coding-agent-feedback.ts";
import { useCodingAgentRouter } from "./coding-agent-router.ts";
import type { SessionListRow } from "./session-list-row.ts";

type Resolved =
  | Readonly<{ kind: "unlisted" }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "turn"; turn: ConversationTurn | null; tenantId: string | undefined }>;

/**
 * Applies a `session=` or `sessionName=` link once: looks the session's last turn up, then opens
 * its terminal replay and drops the link in one address write made from the current address, so
 * a Langy question beside it stays. Spec: specs/coding-agent/sessions-screen.feature
 */
export function useSessionLink({
  projectId,
  rows,
}: {
  projectId: string;
  rows: readonly SessionListRow[];
}): void {
  const utils = codingAgentApi.useUtils();
  const router = useCodingAgentRouter();
  const toaster = useCodingAgentToaster();
  const showErrorToast = useShowErrorToast();
  const link = findSessionLink(router.query);
  const startedRef = useRef(false);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (link === null || startedRef.current) return;
    startedRef.current = true;
    const row = sessionOfLink({ link, rows });
    if (row === null) {
      setResolved({ kind: "unlisted" });
      return;
    }
    const tenantId = memberTenantOf({ tenantId: row.tenantId, projectId });
    lastTurnOfSession({ utils, projectId, sessionId: row.sessionId, tenantId })
      .then((turn) => setResolved({ kind: "turn", turn, tenantId }))
      .catch((error: unknown) => {
        showErrorToast({ error, fallbackTitle: "Couldn't open the terminal replay" });
        setResolved({ kind: "failed" });
      });
  }, [link, rows, projectId, utils, showErrorToast]);

  useEffect(() => {
    if (resolved === null) return;
    setResolved(null);
    if (resolved.kind === "turn" && resolved.turn !== null) {
      openReplayHere({
        turn: resolved.turn,
        projectId,
        tenantId: resolved.tenantId,
        router,
        alsoRemove: withoutSessionLink(),
      });
      return;
    }
    if (resolved.kind === "unlisted") {
      toaster.create({
        title: "That session is not listed here",
        description: "The link names a session this project does not list.",
        type: "info",
      });
    } else if (resolved.kind === "turn") {
      sayNothingWasStored(toaster);
    }
    router.setQueryParams(withoutSessionLink(), { replace: true });
  }, [resolved, projectId, router, toaster]);
}
