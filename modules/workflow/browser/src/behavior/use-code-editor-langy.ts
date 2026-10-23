/**
 * Langy in the Studio code editor: the ask, and the two live actions the open editor registers.
 * A proposal waits for the reader; nothing here saves, runs, or changes the fields.
 * @see specs/langy/langy-studio-code-blocks.feature
 */

import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { readSlice } from "@langwatch/browser-host/global-store";
import { useLentOperations } from "@langwatch/browser-host/lent";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { LangyAskToken } from "@langwatch/langy-client";
import {
  LANGY_ABSENT_REGISTRATIONS,
  LANGY_REGISTRATIONS_SLICE,
  type LangyAskRequest,
  type LangyRegistrationsState,
  type LangyUiActionHandlers,
} from "@langwatch/langy-contract";
import {
  STUDIO_CODE_ACTIONS,
  type StudioCodeProposal,
  type StudioCodeProposeResult,
} from "@langwatch/workflow-contract";
import { type RefObject, useEffect, useRef, useState } from "react";

import type { CodeLanguage } from "../model/code-language.ts";
import {
  CODE_PROPOSE_PERMISSION,
  type CodeBlockLangySubject,
  type CodeBlockSnapshot,
  type CodeEditorAssistant,
  codeBlockAskRequest,
  codeBlockReadAnswer,
  isCodeLangyAvailable,
  LANGY_ASK_PERMISSION,
} from "../model/code/code-block-langy.ts";
import { useWorkflowHost } from "../model/workflow-host.ts";

/** How the editor hands Langy its actions, read from `langy:registrations`; Langy fills it in. */
const useLangyRegistrations = readSlice<LangyRegistrationsState>({
  name: LANGY_REGISTRATIONS_SLICE,
  absent: LANGY_ABSENT_REGISTRATIONS,
});

type PendingProposal = StudioCodeProposal & { nodeId: string; language: CodeLanguage };

/** A refusal the page reports back to the agent by its `code`. */
class StudioCodeActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StudioCodeActionError";
  }
}

export type CodeEditorLangyInput = {
  /** The code node the editor is open on; absent where the editor edits something else. */
  subject: CodeBlockLangySubject | undefined;
  open: boolean;
  language: CodeLanguage;
  /** The code as the workflow holds it. */
  savedCode: string;
  inputs: CodeBlockSnapshot["inputs"];
  outputs: CodeBlockSnapshot["outputs"];
  secretNames: readonly string[];
};

/**
 * The assistant the editor renders while the editor is open on a code node, with the actions
 * registered; `undefined`, and nothing registered, everywhere else.
 */
export function useCodeEditorAssistant({
  subject,
  open,
  language,
  savedCode,
  inputs,
  outputs,
  secretNames,
  ask,
  mayPropose,
}: CodeEditorLangyInput & {
  /** Puts a question to Langy; absent while Langy is unavailable to this reader. */
  ask: ((request: LangyAskRequest) => void) | undefined;
  mayPropose: boolean;
}): CodeEditorAssistant | undefined {
  // A proposal belongs to the code block and language it was made for; any
  // change of either, or closing the editor, drops it.
  const [proposal, setProposal] = useState<PendingProposal | null>(null);
  const pending = useRef<PendingProposal | null>(null);
  const reviewKey = `${open}:${subject?.nodeId ?? ""}:${language}`;
  const [wasKey, setWasKey] = useState(reviewKey);
  if (wasKey !== reviewKey) {
    setWasKey(reviewKey);
    setProposal(null);
  }
  useEffect(() => {
    pending.current = proposal;
  });

  const buffer = useRef(savedCode);
  const latest = useRef<EditorState>({
    subject,
    language,
    savedCode,
    inputs,
    outputs,
    secretNames,
    mayPropose,
  });
  useEffect(() => {
    latest.current = { subject, language, savedCode, inputs, outputs, secretNames, mayPropose };
  });

  const registerActions = useLangyRegistrations((state) => state.registerActions);
  const clearActions = useLangyRegistrations((state) => state.clearActions);
  const enabled = open && subject !== undefined && ask !== undefined;

  useEffect(() => {
    if (!enabled) return undefined;
    registerActions(studioCodeHandlers({ latest, buffer, pending, setProposal }));
    return () => clearActions();
  }, [enabled, registerActions, clearActions]);

  if (!enabled || !subject || !ask) return undefined;

  return {
    ask: (instruction) =>
      ask(
        codeBlockAskRequest({
          instruction,
          snapshot: {
            subject,
            language,
            code: buffer.current,
            savedCode,
            inputs,
            outputs,
            secretNames,
          },
        }),
      ),
    proposal: proposalFor({ proposal, nodeId: subject.nodeId, language }),
    settle: () => {
      pending.current = null;
      setProposal(null);
    },
    observe: (code) => {
      buffer.current = code;
    },
  };
}

type EditorState = {
  subject: CodeBlockLangySubject | undefined;
  language: CodeLanguage;
  savedCode: string;
  inputs: CodeBlockSnapshot["inputs"];
  outputs: CodeBlockSnapshot["outputs"];
  secretNames: readonly string[];
  mayPropose: boolean;
};

/** The proposal as the editor shows it: only on the code block and language it was made for. */
function proposalFor({
  proposal,
  nodeId,
  language,
}: {
  proposal: PendingProposal | null;
  nodeId: string;
  language: CodeLanguage;
}): StudioCodeProposal | null {
  if (!proposal || proposal.nodeId !== nodeId || proposal.language !== language) return null;
  return { code: proposal.code, summary: proposal.summary };
}

/** The read and propose handlers, over the editor's latest state rather than a render's. */
function studioCodeHandlers({
  latest,
  buffer,
  pending,
  setProposal,
}: {
  latest: RefObject<EditorState>;
  buffer: RefObject<string>;
  pending: RefObject<PendingProposal | null>;
  setProposal: (proposal: PendingProposal) => void;
}): LangyUiActionHandlers {
  return {
    "studio.code.read": {
      payloadSchema: STUDIO_CODE_ACTIONS["studio.code.read"].payloadSchema,
      run: () => {
        const { subject, ...rest } = latest.current;
        if (!subject)
          throw new StudioCodeActionError("studio_code_editor_closed", "No code block.");
        return codeBlockReadAnswer({ ...rest, subject, code: buffer.current });
      },
    },
    "studio.code.propose": {
      payloadSchema: STUDIO_CODE_ACTIONS["studio.code.propose"].payloadSchema,
      run: (payload: StudioCodeProposal): StudioCodeProposeResult => {
        const { mayPropose, subject, language } = latest.current;
        if (!mayPropose) {
          throw new StudioCodeActionError(
            "studio_code_permission_denied",
            "The reader may not edit this workflow.",
          );
        }
        if (!subject)
          throw new StudioCodeActionError("studio_code_editor_closed", "No code block.");
        if (pending.current) {
          throw new StudioCodeActionError(
            "studio_code_proposal_pending",
            "A proposal is awaiting the reader's review; wait until they accept or reject it.",
          );
        }
        const next = {
          code: payload.code,
          summary: payload.summary,
          nodeId: subject.nodeId,
          language,
        };
        pending.current = next;
        setProposal(next);
        return { status: "awaiting_review" };
      },
    },
  };
}

/** Langy's assistant in the code editor, offered only where Langy is available to this reader. */
export function useCodeEditorLangy(input: CodeEditorLangyInput): CodeEditorAssistant | undefined {
  const lent = useLentOperations(LangyAskToken);
  const flag = useUiFlags().flag(FrontendFlags.release_langy_enabled);
  const host = useWorkflowHost();
  const available = isCodeLangyAvailable({
    flag,
    mayAsk: host.hasPermission(LANGY_ASK_PERMISSION),
    installed: lent !== undefined,
  });
  const ask =
    available && lent
      ? (request: LangyAskRequest) => void lent().then((langy) => langy.ask(request))
      : undefined;

  return useCodeEditorAssistant({
    ...input,
    ask,
    mayPropose: host.hasPermission(CODE_PROPOSE_PERMISSION),
  });
}
