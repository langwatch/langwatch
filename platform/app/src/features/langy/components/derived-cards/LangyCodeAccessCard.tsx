/**
 * The code access card (ADR-129) — how Langy reaches the customer's own code.
 *
 * Langy asks once per conversation, through its `code_access` tool, and this
 * card is the ask. It has four states, and every one of them is read from
 * `langy.getLocalWorkspace` rather than from the tool call: the folder can
 * connect minutes after the turn ended, and the remembered choice can be
 * cleared from the settings page, so the tool call is only WHERE the card
 * hangs, never WHAT it says.
 *
 *   asking     no folder, nothing remembered — the two ways to reach the code
 *   waiting    the local folder was picked; the command and the countdown
 *   connected  the folder is shared, with the machine and the branch
 *   remembered GitHub was remembered — one line, with a way to change it
 *
 * Picking GitHub is a CHOICE, so it travels the ordinary choices path: the
 * selection becomes the next user message and Langy continues on the pull
 * request flow. Picking the local folder sends nothing: the request already
 * exists (the tool recorded it), and connecting the folder starts the next
 * turn on its own.
 */
import {
  Box,
  Button,
  chakra,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type {
  LangyChoiceSelection,
  LangyDerivedChoicesCard,
} from "@langwatch/langy";
import { Check, FolderCode, GitPullRequest } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { CopyButton } from "~/components/CopyButton";
import { describeError } from "~/features/errors";
import { SHARE_CONTROL_COMMAND } from "~/server/langy-local-control/constants";
import { api } from "~/utils/api";

import { useLangyLocalControlStore } from "../../stores/langyLocalControlStore";
import { LangyGitHubConnectCard } from "../github/LangyGitHubConnectCard";

/** The option ids the selection carries, so the message reads the same words. */
export const LANGY_CODE_ACCESS_OPTIONS = {
  LOCAL: "local",
  GITHUB: "github",
} as const;

const LOCAL_LABEL = "Share my local folder";
const LOCAL_SUBTITLE = "Fastest: I run the toolchain you already have";
const GITHUB_LABEL = "Use GitHub";
const GITHUB_SUBTITLE =
  "I open a pull request through the LangWatch GitHub App";

/**
 * The choices card the GitHub selection binds to. The panel answers it through
 * the same `onChoiceSelect` a question card uses, so the reader's pick becomes
 * their own message with no second send path.
 */
export function langyCodeAccessChoicesCard(
  callId: string,
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
    ],
  };
}

/** The GitHub pick, as the choices path carries it. */
function githubSelection(callId: string): {
  selection: LangyChoiceSelection;
  card: LangyDerivedChoicesCard;
} {
  const card = langyCodeAccessChoicesCard(callId);
  return {
    selection: {
      blockId: card.blockId,
      optionIds: [LANGY_CODE_ACCESS_OPTIONS.GITHUB],
    },
    card,
  };
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
  onChoiceSelect?: (a: {
    selection: LangyChoiceSelection;
    card: LangyDerivedChoicesCard;
  }) => void;
  /** Stop any running turn and ask Langy the question again. */
  onAskAgain?: () => void;
  /** Test seam: the clock the countdown reads. */
  now?: () => number;
}

/**
 * Which of the four states the card is in. A pure reading of the one query, so
 * the decision is testable and the component below only renders it.
 */
export function langyCodeAccessState({
  connected,
  preference,
  hasRequest,
  pickedLocal,
}: {
  connected: boolean;
  preference: "github" | null;
  hasRequest: boolean;
  pickedLocal: boolean;
}): "connected" | "remembered" | "waiting" | "asking" {
  if (connected) return "connected";
  if (preference === "github") return "remembered";
  if (hasRequest || pickedLocal) return "waiting";
  return "asking";
}

/** What `langy.getLocalWorkspace` answers, as the card reads it. */
type LangyLocalWorkspaceStatus = {
  connected: boolean;
  workspace: {
    root: string;
    hostname: string;
    gitBranch?: string | null;
  } | null;
  pendingRequest: { expiresAt: string } | null;
  codeAccessPreference: "github" | null;
};

export function LangyCodeAccessCard(props: LangyCodeAccessCardProps) {
  const { projectId, conversationId } = props;
  const workspaceRevision = useLangyLocalControlStore(
    (s) => s.workspaceRevision,
  );
  const workspace = api.langy.getLocalWorkspace.useQuery(
    { projectId, conversationId },
    { enabled: !!projectId && !!conversationId },
  );

  // The live stream says the folder came or went; the query says what it is.
  const refetch = workspace.refetch;
  useEffect(() => {
    if (workspaceRevision === 0) return;
    void refetch();
  }, [workspaceRevision, refetch]);

  const data = workspace.data;
  if (workspace.isLoading || !data) return <LoadingState />;
  return <CodeAccessBody {...props} folder={data} onRefetch={refetch} />;
}

/** The card once the one query has answered: one state, one body. */
function CodeAccessBody({
  folder,
  onRefetch,
  ...props
}: LangyCodeAccessCardProps & {
  folder: LangyLocalWorkspaceStatus;
  onRefetch: () => void;
}) {
  const [pickedLocal, setPickedLocal] = useState(false);
  const { projectId, onAskAgain, now } = props;
  const request = folder.pendingRequest;
  const state = langyCodeAccessState({
    connected: folder.connected && !!folder.workspace,
    preference: folder.codeAccessPreference,
    hasRequest: !!request,
    pickedLocal,
  });

  if (state === "connected" && folder.workspace) {
    return <ConnectedState folder={folder.workspace} />;
  }
  if (state === "remembered") {
    return (
      <RememberedState
        projectId={projectId}
        onCleared={onRefetch}
        onAskAgain={onAskAgain}
      />
    );
  }
  if (state === "waiting") {
    return (
      <CardShell>
        <WaitingState
          expiresAt={request ? Date.parse(request.expiresAt) : null}
          now={now ?? Date.now}
          onAskAgain={onAskAgain}
        />
      </CardShell>
    );
  }
  return <AskingState {...props} onPickLocal={() => setPickedLocal(true)} />;
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

  const answerWithGithub = () => onChoiceSelect?.(githubSelection(callId));

  const chooseGithub = () => {
    setFailure(null);
    // Nothing to open a pull request with yet. The install card goes here, in
    // place of the option, so the reader finishes the choice they made rather
    // than reading a failure a turn later.
    if (organizationId && !installed) {
      setInstalling(true);
      return;
    }
    if (!remember) {
      answerWithGithub();
      return;
    }
    rememberChoice.mutate(
      { projectId, preference: "github" },
      {
        onSuccess: answerWithGithub,
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
        <RememberBox
          checked={remember}
          disabled={!onChoiceSelect}
          onChange={setRemember}
        />
        {failure ? <FailureLine text={failure} /> : null}
      </VStack>
    </CardShell>
  );
}

/**
 * The memory box, and what it does not cover. A folder is shared for one
 * conversation and one session, so there is nothing about it to remember, and
 * saying so where the box is keeps the reader from expecting it to hold.
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
    <>
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
      <Text textStyle="2xs" color="fg.subtle">
        Only GitHub is remembered. A folder is shared again each time.
      </Text>
    </>
  );
}

/** The waiting state: the one command, the countdown, and what comes next. */
function WaitingState({
  expiresAt,
  now,
  onAskAgain,
}: {
  expiresAt: number | null;
  now: () => number;
  onAskAgain: (() => void) | undefined;
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

  const expired = remainingMs !== null && remainingMs <= 0;

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
        <CopyButton
          size="xs"
          value={SHARE_CONTROL_COMMAND}
          label="The command"
          aria-label="Copy the command"
        />
      </HStack>
      {expired ? (
        <HStack gap={2} justifyContent="space-between">
          <Text textStyle="2xs" color="fg.muted">
            Request expired, ask again
          </Text>
          {onAskAgain ? (
            <Button size="xs" variant="outline" onClick={onAskAgain}>
              Ask again
            </Button>
          ) : null}
        </HStack>
      ) : (
        <HStack gap={2}>
          <Spinner size="xs" />
          <Text textStyle="2xs" color="fg.muted">
            Waiting for you to approve in the terminal
            {remainingMs === null ? "" : `. ${expiresIn(remainingMs)}`}
          </Text>
        </HStack>
      )}
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

function CardShell({ children }: { children: ReactNode }) {
  return (
    <Box
      data-testid="langy-code-access-card"
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
