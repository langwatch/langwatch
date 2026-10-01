import {
  Box,
  Button,
  chakra,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type {
  LangyChoiceSelection,
  LangyControlRequestState,
  LangyDerivedChoicesCard,
} from "@langwatch/langy-contract";
import { SHARE_CONTROL_COMMAND } from "@langwatch/langy-contract";
/**
 * The code access card (ADR-129): four states, all read from `langy.getLocalWorkspace` rather
 * than the tool call, which is only where the card hangs, never what it says.
 */
import { nowInstant, toEpochMs } from "@langwatch/time";
import { Check, FolderCode, FolderOpen, GitPullRequest } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { describeError } from "../../../behavior/errors.tsx";
import { api } from "../../../behavior/langy-api.ts";
import { useLangyLocalControlStore } from "../../../behavior/langy-local-control.store.ts";
import { LangyGitHubConnectCard } from "../../../features/langy/ui/sections/github/langy-git-hub-connect-card.tsx";
import {
  readLocalFolderPick,
  writeLocalFolderPick,
} from "../../../model/langy-code-access-pick.ts";
import {
  type LangyLocalWorkspaceRead,
  parseLangyLocalWorkspace,
} from "../../../model/langy-local-workspace.ts";
import { LangyCopyButton } from "../../elements/langy-copy-button.tsx";

/** The option ids the selection carries, so the message reads the same words. */
export const LANGY_CODE_ACCESS_OPTIONS = {
  LOCAL: "local",
  GITHUB: "github",
  DESCRIBE: "describe",
} as const;

const LOCAL_LABEL = "Share local folder";
const LOCAL_SUBTITLE = "Fastest: I run the toolchain you already have";
const GITHUB_LABEL = "Connect to GitHub";
const GITHUB_SUBTITLE = "I open a pull request through the LangWatch GitHub App";
/** The quiet third way out, offered only when the tool asked for it. */
export const LANGY_CODE_ACCESS_DESCRIBE_LABEL = "I'd rather describe it";

/**
 * The choices card the GitHub selection binds to. The panel answers it through
 * the same `onChoiceSelect` a question card uses, so the reader's pick becomes
 * their own message with no second send path.
 */
export function langyCodeAccessChoicesCard(
  callId: string,
  { offerDescribe = false }: { offerDescribe?: boolean } = {},
): LangyDerivedChoicesCard {
  return {
    blockId: `code-access:${callId}`,
    kind: "choices",
    question: "How should I reach your code?",
    options: [
      {
        id: LANGY_CODE_ACCESS_OPTIONS.LOCAL,
        label: LOCAL_LABEL,
        description: LOCAL_SUBTITLE,
      },
      {
        id: LANGY_CODE_ACCESS_OPTIONS.GITHUB,
        label: GITHUB_LABEL,
        description: GITHUB_SUBTITLE,
      },
      ...(offerDescribe
        ? [
            {
              id: LANGY_CODE_ACCESS_OPTIONS.DESCRIBE,
              label: LANGY_CODE_ACCESS_DESCRIBE_LABEL,
              quiet: true,
            },
          ]
        : []),
    ],
  };
}

/** One pick, as the choices path carries it. */
function codeAccessSelection({
  callId,
  optionId,
  offerDescribe,
}: {
  callId: string;
  optionId: string;
  offerDescribe: boolean;
}): {
  selection: LangyChoiceSelection;
  card: LangyDerivedChoicesCard;
} {
  const card = langyCodeAccessChoicesCard(callId, { offerDescribe });
  return { selection: { blockId: card.blockId, optionIds: [optionId] }, card };
}

/** What Langy is asked when the reader wants the question put again. */
export const LANGY_CODE_ACCESS_ASK_AGAIN = "Ask me again how to reach my code.";

export interface LangyCodeAccessCardProps {
  projectId: string;
  conversationId: string;
  /** The `code_access` call this card hangs on — the selection's identity. */
  callId: string;
  /** Reads whether the GitHub App is installed. Absent = the state is unknown. */
  organizationId?: string | null;
  /** Answer with the GitHub choice. Absent = read-only (time travel). */
  onChoiceSelect?: (a: { selection: LangyChoiceSelection; card: LangyDerivedChoicesCard }) => void;
  /** Stop any running turn and ask Langy the question again. */
  onAskAgain?: () => void;
  /** A newer `code_access` call exists, so this is the older ask: reads closed, answers nothing. */
  superseded?: boolean;
  /** The tool asked for the quiet third way out, "I'd rather describe it". */
  offerDescribe?: boolean;
  /** Test seam: the clock the countdown reads. */
  now?: () => number;
}

/**
 * Which of the four states the card is in — a pure reading of the query and the developer's own
 * pick. Waiting is driven by the pick alone, never the open control request, since a request
 * exists by the time the card first mounts.
 */
export function langyCodeAccessState({
  connected,
  preference,
  pickedLocal,
}: {
  connected: boolean;
  preference: "github" | null;
  pickedLocal: boolean;
}): "connected" | "remembered" | "waiting" | "asking" {
  if (connected) return "connected";
  if (preference === "github") return "remembered";
  if (pickedLocal) return "waiting";
  return "asking";
}

/** Why a picked card has nothing to wait for. */
export type LangyCodeAccessClosedReason = "expired" | "declined" | "ended" | "over";

/**
 * Whether the waiting card still has something to wait for. The platform's reading decides;
 * the clock only closes an open request whose time ran out between two reads.
 */
export function langyCodeAccessClosedReason({
  requestState,
  expiresAt,
  now,
}: {
  requestState: LangyControlRequestState;
  expiresAt: number | null;
  now: number;
}): LangyCodeAccessClosedReason | null {
  if (requestState === "open" || requestState === "approved") {
    return expiresAt !== null && expiresAt <= now ? "expired" : null;
  }
  if (requestState === "none") return "over";
  return requestState;
}

const CLOSED_COPY: Record<LangyCodeAccessClosedReason, { line: string; action: string }> = {
  expired: { line: "This request expired.", action: "Try again" },
  declined: { line: "This request was declined in the terminal.", action: "Try again" },
  ended: { line: "Sharing stopped.", action: "Share again" },
  over: { line: "This request is closed.", action: "Try again" },
};

export function LangyCodeAccessCard(props: LangyCodeAccessCardProps) {
  const { projectId, conversationId } = props;
  const superseded = props.superseded ?? false;
  const workspaceRevision = useLangyLocalControlStore((s) => s.workspaceRevision);
  const workspace = api.langy.getLocalWorkspace.useQuery(
    { projectId, conversationId },
    { select: parseLangyLocalWorkspace, enabled: !!projectId && !!conversationId && !superseded },
  );

  // The live stream says the folder came or went; the query says what it is.
  const refetch = workspace.refetch;
  useEffect(() => {
    if (workspaceRevision === 0) return;
    void refetch();
  }, [workspaceRevision, refetch]);

  if (superseded) return <SupersededState />;
  const data = workspace.data;
  // A read that failed is not a read that is still running. Rendering the
  // loading line for both left the card saying it was checking, for ever,
  // with no error, no retry and no way to answer the question.
  if (workspace.isError && !data) {
    return <UnreadableState error={workspace.error} onRetry={refetch} />;
  }
  if (workspace.isLoading || !data) return <LoadingState />;
  return <CodeAccessBody {...props} folder={data} onRefetch={refetch} />;
}

/** The card once the one query has answered: one state, one body. */
function CodeAccessBody({
  folder,
  onRefetch,
  ...props
}: LangyCodeAccessCardProps & {
  folder: LangyLocalWorkspaceRead;
  onRefetch: () => void;
}) {
  const { projectId, conversationId, callId, onAskAgain, now } = props;
  const [pickedLocal, setPickedLocal] = useState(() =>
    readLocalFolderPick({ conversationId, callId }),
  );
  const [renewFailure, setRenewFailure] = useState<string | null>(null);
  const renew = api.langy.renewLocalControlRequest.useMutation();
  const openFreshRequest = () => {
    setRenewFailure(null);
    renew.mutate(
      { projectId, conversationId },
      {
        onSuccess: () => onRefetch(),
        onError: (error) =>
          setRenewFailure(describeError({ error, fallbackTitle: "Could not open a new request" })),
      },
    );
  };
  const pickLocal = () => {
    writeLocalFolderPick({ conversationId, callId });
    setPickedLocal(true);
    // The request Langy recorded when it asked may be over by the time the reader picks.
    if (folder.requestState !== "open") openFreshRequest();
  };
  // A card with no way to answer is a past conversation being read.
  const readOnly = !props.onChoiceSelect && !onAskAgain;
  const request = folder.pendingRequest;
  const state = langyCodeAccessState({
    connected: folder.connected && !!folder.workspace,
    preference: folder.codeAccessPreference,
    pickedLocal,
  });

  if (state === "connected" && folder.workspace) {
    return <ConnectedState folder={folder.workspace} />;
  }
  if (state === "remembered") {
    return <RememberedState projectId={projectId} onCleared={onRefetch} onAskAgain={onAskAgain} />;
  }
  if (state === "waiting") {
    return (
      <CardShell>
        <WaitingState
          requestState={folder.requestState}
          expiresAt={request ? toEpochMs(request.expiresAt) : null}
          now={now ?? (() => nowInstant().epochMilliseconds)}
          onExpired={onRefetch}
          onTryAgain={readOnly ? undefined : openFreshRequest}
          tryingAgain={renew.isPending}
          failure={renewFailure}
        />
      </CardShell>
    );
  }
  return <AskingState {...props} onPickLocal={pickLocal} />;
}

/** The older ask, once Langy has asked again: readable, closed, unanswerable. */
function SupersededState() {
  return (
    <CardShell superseded>
      <VStack align="stretch" gap={1}>
        <HStack gap={2}>
          <Box color="fg.muted" display="flex">
            <FolderCode size={14} />
          </Box>
          <Text textStyle="xs" color="fg.muted">
            How should I reach your code?
          </Text>
        </HStack>
        <Text textStyle="2xs" color="fg.subtle">
          Asked again further down. Answer the newer card.
        </Text>
      </VStack>
    </CardShell>
  );
}

function LoadingState() {
  return (
    <CardShell>
      <HStack gap={2}>
        <Spinner size="xs" />
        <Text textStyle="xs" color="fg.muted">
          Checking how I can reach your code
        </Text>
      </HStack>
    </CardShell>
  );
}

/**
 * The one query behind every state of this card failed. Words come from the shared registry
 * keyed on the error's code; the card offers the read again as the only way forward.
 */
function UnreadableState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <CardShell>
      <VStack align="stretch" gap={2}>
        <Text textStyle="xs" color="fg" role="alert">
          {describeError({
            error,
            fallbackTitle: "I could not check how to reach your code",
          })}
        </Text>
        <HStack gap={2}>
          <Button size="xs" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </HStack>
      </VStack>
    </CardShell>
  );
}

/** The folder is shared: which folder, on which machine, on which branch. */
function ConnectedState({
  folder,
}: {
  folder: { root: string; hostname: string; gitBranch?: string | null };
}) {
  return (
    <CardShell>
      <HStack gap={2}>
        <Box color="green.fg" display="flex">
          <Check size={14} />
        </Box>
        <Text textStyle="xs" color="fg">
          Connected: {folder.root} on {folder.hostname}
          {folder.gitBranch ? `, branch ${folder.gitBranch}` : ""}
        </Text>
      </HStack>
    </CardShell>
  );
}

/** GitHub was remembered: one line, and the way to take it back. */
function RememberedState({
  projectId,
  onCleared,
  onAskAgain,
}: {
  projectId: string;
  onCleared: () => void;
  onAskAgain: (() => void) | undefined;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const clear = api.langy.setCodeAccessPreference.useMutation();

  return (
    <CardShell>
      <HStack gap={2} justifyContent="space-between">
        <HStack gap={2} minWidth={0}>
          <Box color="fg.muted" display="flex">
            <GitPullRequest size={14} />
          </Box>
          <Text textStyle="xs" color="fg" truncate>
            Using GitHub (remembered)
          </Text>
        </HStack>
        {onAskAgain ? (
          <Button
            size="xs"
            variant="ghost"
            loading={clear.isPending}
            onClick={() => {
              setFailure(null);
              clear.mutate(
                { projectId, preference: null },
                {
                  onSuccess: () => {
                    onCleared();
                    onAskAgain();
                  },
                  onError: (error) =>
                    setFailure(
                      describeError({
                        error,
                        fallbackTitle: "Could not clear the remembered choice",
                      }),
                    ),
                },
              );
            }}
          >
            Change
          </Button>
        ) : null}
      </HStack>
      {failure ? <FailureLine text={failure} /> : null}
    </CardShell>
  );
}

/** The question itself: the two ways to reach the code, and the memory box. */
function AskingState({
  projectId,
  callId,
  organizationId,
  onChoiceSelect,
  onPickLocal,
  offerDescribe = false,
}: LangyCodeAccessCardProps & { onPickLocal: () => void }) {
  const github = api.github.getConnectionStatus.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );
  const rememberChoice = api.langy.setCodeAccessPreference.useMutation();
  const [remember, setRemember] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const installations = github.data?.installations ?? [];
  const installed = installations.length > 0;

  const answerWithGithub = () =>
    onChoiceSelect?.(
      codeAccessSelection({ callId, optionId: LANGY_CODE_ACCESS_OPTIONS.GITHUB, offerDescribe }),
    );
  const answerWithDescribe = () =>
    onChoiceSelect?.(
      codeAccessSelection({
        callId,
        optionId: LANGY_CODE_ACCESS_OPTIONS.DESCRIBE,
        offerDescribe: true,
      }),
    );

  const rememberThen = (next: () => void) => {
    if (!remember) {
      next();
      return;
    }
    rememberChoice.mutate(
      { projectId, preference: "github" },
      {
        onSuccess: next,
        onError: (error) =>
          setFailure(
            describeError({
              error,
              fallbackTitle: "Could not remember your choice",
            }),
          ),
      },
    );
  };

  const chooseGithub = () => {
    setFailure(null);
    // Nothing to open a pull request with yet. The install card goes here, in
    // place of the option, so the reader finishes the choice they made rather
    // than reading a failure a turn later. The ticked box is stored on the way
    // in: the choice was made here, and the install is the next step of it, not
    // a condition of it.
    if (organizationId && !installed) {
      rememberThen(() => setInstalling(true));
      return;
    }
    rememberThen(answerWithGithub);
  };

  return (
    <CardShell>
      <VStack align="stretch" gap={2}>
        <Text textStyle="xs" fontWeight="640" color="fg">
          How should I reach your code?
        </Text>
        <OptionRow
          icon={<FolderCode size={14} />}
          label={LOCAL_LABEL}
          subtitle={LOCAL_SUBTITLE}
          disabled={!onChoiceSelect}
          onClick={onPickLocal}
        />
        <OptionRow
          icon={<GitPullRequest size={14} />}
          label={GITHUB_LABEL}
          subtitle={GITHUB_SUBTITLE}
          note={githubInstallNote({
            known: !!organizationId && !github.isLoading,
            installed,
            account: installations[0]?.accountLogin,
          })}
          disabled={!onChoiceSelect || rememberChoice.isPending}
          onClick={chooseGithub}
        />
        {installing && organizationId ? (
          <LangyGitHubConnectCard
            organizationId={organizationId}
            headline="Install the LangWatch GitHub App so I can open the pull request"
            onConnected={() => {
              setInstalling(false);
              void github.refetch();
              answerWithGithub();
            }}
          />
        ) : null}
        {offerDescribe ? (
          <chakra.button
            type="button"
            data-testid="langy-code-access-describe"
            disabled={!onChoiceSelect}
            onClick={answerWithDescribe}
            alignSelf="flex-start"
            paddingX={1}
            paddingTop={0.5}
            textStyle="xs"
            textDecoration="underline"
            textUnderlineOffset="2px"
            background="transparent"
            color="fg.muted"
            cursor={onChoiceSelect ? "pointer" : "default"}
            _hover={onChoiceSelect ? { color: "fg" } : undefined}
          >
            {LANGY_CODE_ACCESS_DESCRIBE_LABEL}
          </chakra.button>
        ) : null}
        <RememberBox checked={remember} disabled={!onChoiceSelect} onChange={setRemember} />
        {failure ? <FailureLine text={failure} /> : null}
      </VStack>
    </CardShell>
  );
}

/**
 * The memory box. Only the GitHub choice is stored: a folder is shared for one
 * conversation and one session, so choosing it with the box ticked stores
 * nothing.
 */
function RememberBox({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <chakra.label display="flex" alignItems="center" gap={1.5}>
      <chakra.input
        type="checkbox"
        data-testid="langy-remember-code-access"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <Text textStyle="2xs" color="fg.muted">
        Remember this choice
      </Text>
    </chakra.label>
  );
}

/** The waiting state: the one command, the countdown, and what comes next. */
function WaitingState({
  requestState,
  expiresAt,
  now,
  onExpired,
  onTryAgain,
  tryingAgain,
  failure,
}: {
  requestState: LangyControlRequestState;
  expiresAt: number | null;
  now: () => number;
  /** The countdown reached zero: the platform is asked what it reads now. */
  onExpired: () => void;
  /** Open a fresh request. Absent = read-only. */
  onTryAgain: (() => void) | undefined;
  tryingAgain: boolean;
  failure: string | null;
}) {
  const [remainingMs, setRemainingMs] = useState(() =>
    expiresAt === null ? null : expiresAt - now(),
  );

  useEffect(() => {
    if (expiresAt === null) {
      setRemainingMs(null);
      return;
    }
    setRemainingMs(expiresAt - now());
    const timer = setInterval(() => setRemainingMs(expiresAt - now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, now]);

  const closed = langyCodeAccessClosedReason({ requestState, expiresAt, now: now() });

  // An open request that ran out on screen: the platform's reading replaces the clock's, once.
  const ranOutOnScreen = closed === "expired" && requestState === "open";
  useEffect(() => {
    if (ranOutOnScreen) onExpired();
  }, [ranOutOnScreen, onExpired]);

  if (closed) {
    return (
      <ClosedRequestState
        reason={closed}
        onTryAgain={onTryAgain}
        tryingAgain={tryingAgain}
        failure={failure}
      />
    );
  }

  return (
    <VStack align="stretch" gap={2}>
      <Text textStyle="xs" color="fg">
        Run this in the folder you want me to work in:
      </Text>
      <HStack
        gap={1}
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        paddingLeft={2}
        background="bg.muted"
      >
        <Text
          textStyle="2xs"
          fontFamily="mono"
          color="fg"
          flex={1}
          overflowX="auto"
          whiteSpace="nowrap"
        >
          {SHARE_CONTROL_COMMAND}
        </Text>
        <LangyCopyButton size="xs" value={SHARE_CONTROL_COMMAND} label="The command" />
      </HStack>
      <HStack gap={2}>
        <Spinner size="xs" />
        <Text textStyle="2xs" color="fg.muted">
          Waiting for you to approve in the terminal
          {remainingMs === null ? "" : `. ${expiresIn(remainingMs)}`}
        </Text>
      </HStack>
    </VStack>
  );
}

/**
 * The picked card once no terminal can approve anything: why, and the way to a fresh request.
 * The command is left out on purpose, because running it now finds nothing to approve.
 */
function ClosedRequestState({
  reason,
  onTryAgain,
  tryingAgain,
  failure,
}: {
  reason: LangyCodeAccessClosedReason;
  onTryAgain: (() => void) | undefined;
  tryingAgain: boolean;
  failure: string | null;
}) {
  const copy = CLOSED_COPY[reason];
  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={2} justifyContent="space-between">
        <HStack gap={2} minWidth={0}>
          <Box color="fg.muted" display="flex">
            <FolderOpen size={14} />
          </Box>
          <Text textStyle="xs" color="fg">
            {copy.line}
          </Text>
        </HStack>
        {onTryAgain ? (
          <Button size="xs" variant="outline" loading={tryingAgain} onClick={onTryAgain}>
            {copy.action}
          </Button>
        ) : null}
      </HStack>
      {failure ? <FailureLine text={failure} /> : null}
    </VStack>
  );
}

/** "Expires in 12 minutes" / "Expires in 40 seconds". Never an abbreviation. */
export function expiresIn(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `Expires in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `Expires in ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

/** Whether the GitHub App can open a pull request today, in the reader's words. */
export function githubInstallNote({
  known,
  installed,
  account,
}: {
  known: boolean;
  installed: boolean;
  account?: string | undefined;
}): string | undefined {
  if (!known) return undefined;
  if (!installed) return "Install the app first";
  return account ? `Installed on ${account}` : "Installed";
}

function OptionRow({
  icon,
  label,
  subtitle,
  note,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  subtitle: string;
  note?: string | undefined;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      data-testid="langy-code-access-option"
      disabled={disabled}
      onClick={onClick}
      display="flex"
      alignItems="flex-start"
      gap={2}
      textAlign="left"
      paddingX={2}
      paddingY={1.5}
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      borderRadius="md"
      background="transparent"
      cursor={disabled ? "default" : "pointer"}
      opacity={disabled ? 0.6 : 1}
      _hover={disabled ? undefined : { background: "bg.muted" }}
    >
      <Box color="fg.muted" display="flex" paddingTop="2px" flexShrink={0}>
        {icon}
      </Box>
      <VStack align="stretch" gap={0} minWidth={0}>
        <Text textStyle="xs" color="fg">
          {label}
        </Text>
        <Text textStyle="2xs" color="fg.muted">
          {subtitle}
        </Text>
        {note ? (
          <Text textStyle="2xs" color="fg.subtle">
            {note}
          </Text>
        ) : null}
      </VStack>
    </chakra.button>
  );
}

function FailureLine({ text }: { text: string }) {
  return (
    <Text textStyle="2xs" color="red.fg" role="alert">
      {text}
    </Text>
  );
}

function CardShell({
  children,
  superseded = false,
}: {
  children: ReactNode;
  superseded?: boolean;
}) {
  return (
    <Box
      data-testid="langy-code-access-card"
      data-superseded={superseded ? "true" : undefined}
      opacity={superseded ? 0.65 : 1}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      maxWidth="420px"
      background="bg.subtle"
    >
      {children}
    </Box>
  );
}
