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
 * Applies each `session=` or `sessionName=` link once the list has loaded: looks the session's
 * last turn up, then opens its replay and drops the link in one address write from the current
 * address, so a Langy question beside it stays. Spec: specs/coding-agent/sessions-screen.feature
 */
export function useSessionLink({
  projectId,
  rows,
  isLoaded,
}: {
  projectId: string;
  rows: readonly SessionListRow[];
  isLoaded: boolean;
}): void {
  const utils = codingAgentApi.useUtils();
  const showErrorToast = useShowErrorToast();
  const router = useCodingAgentRouter();
  const link = findSessionLink(router.query);
  const linkKey = JSON.stringify(link);
  const handledLinkRef = useRef<string | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (link === null) {
      handledLinkRef.current = null;
      return;
    }
    if (!isLoaded || handledLinkRef.current === linkKey) return;
    handledLinkRef.current = linkKey;
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
  }, [link, linkKey, isLoaded, rows, projectId, utils, showErrorToast]);

  useAppliedSessionLink({ resolved, setResolved, projectId });
}

/** Acts on a resolved link: opens the replay, or says why it could not, then drops the link. */
function useAppliedSessionLink({
  resolved,
  setResolved,
  projectId,
}: {
  resolved: Resolved | null;
  setResolved: (next: null) => void;
  projectId: string;
}): void {
  const router = useCodingAgentRouter();
  const toaster = useCodingAgentToaster();

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
  }, [resolved, setResolved, projectId, router, toaster]);
}
