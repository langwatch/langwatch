import { Link } from "@langwatch/browser-host/link";
import {
  Box,
  Button,
  HStack,
  IconButton,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { modelProviderIcons } from "@langwatch/design-system/provider-icons";
import { Check, Copy, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import {
  type CodexSignInPhase,
  useCodexDeviceSignIn,
} from "../../behavior/use-codex-device-sign-in.ts";
import { langyFirstPartyLinkProps } from "../../model/langy-first-party-link.ts";
import type { ScopeAssignment } from "../../model/scope-assignment.ts";

/**
 * Codex's whole credential UI, shared verbatim by settings, Langy's inline setup and onboarding
 * (spec: specs/model-providers/codex-account-provider.feature). Renders `useCodexDeviceSignIn`'s
 * phases only; settings passes `setAsCodingDefaults: false` and asks separately post-connect.
 */
export function CodexSignIn({
  guided = false,
  projectId,
  scopes,
  setAsCodingDefaults,
  onConnected,
  onFailed,
}: {
  /** Onboarding's wording: the account is named ChatGPT, as the plan it runs on. */
  guided?: boolean;
  projectId: string;
  /** Where the provider row saves — callers pass the widest manageable scope. */
  scopes: ScopeAssignment[];
  /** Langy setup + onboarding pass true: also point Langy and the tiny
   *  assists at the codex model. Settings passes false. */
  setAsCodingDefaults: boolean;
  onConnected?: (account: { email: string; plan: string }) => void;
  /** Told once when a sign-in ends in an error: which kind, timed out or failed. */
  onFailed?: (code: "codex_sign_in_timed_out" | "codex_sign_in_failed") => void;
}) {
  const signIn = useCodexDeviceSignIn({
    projectId,
    scopes,
    setAsCodingDefaults,
    onConnected,
  });
  const { phase, connected } = signIn;
  const failedCode = phase.name === "error" ? failureCodeOf({ timedOut: phase.timedOut }) : null;
  const reportFailure = useEffectEvent((code: NonNullable<typeof failedCode>) => onFailed?.(code));
  useEffect(() => {
    if (failedCode) reportFailure(failedCode);
  }, [failedCode]);

  if (!guided && connected && phase.name !== "pending" && phase.name !== "starting") {
    return (
      <ConnectedPanel
        account={connected}
        canDisconnect={!!signIn.storedProviderId}
        disconnecting={signIn.disconnecting}
        onReauthenticate={() => void signIn.begin()}
        onDisconnect={signIn.disconnect}
      />
    );
  }
  if (guided) {
    return <GuidedCodexActions signIn={signIn} disabled={!projectId} />;
  }
  if (phase.name === "pending") {
    return <PendingApprovalPanel pending={phase} onCancel={signIn.cancel} />;
  }
  return <StartPanel phase={phase} onStart={() => void signIn.begin()} />;
}

/** Connected state: who is signed in, plus re-authenticate / disconnect. */
function ConnectedPanel({
  account,
  canDisconnect,
  disconnecting,
  onReauthenticate,
  onDisconnect,
}: {
  account: { email: string; plan: string };
  canDisconnect: boolean;
  disconnecting: boolean;
  onReauthenticate: () => void;
  onDisconnect: () => void;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <HStack gap={2}>
        <Box color="green.fg">
          <Check size={15} />
        </Box>
        <Text fontSize="sm">
          Connected as <b>{account.email || "your OpenAI account"}</b>
          {account.plan ? ` (${account.plan})` : null}
        </Text>
      </HStack>
      <Text fontSize="xs" color="fg.muted">
        Langy and the AI assists run on this account's plan. Usage counts against your OpenAI
        subscription limits, not API credits.
      </Text>
      <HStack gap={2}>
        <Button size="xs" variant="outline" onClick={onReauthenticate}>
          <RefreshCw size={13} /> Re-authenticate
        </Button>
        {canDisconnect ? (
          <Button
            size="xs"
            variant="ghost"
            color="fg.muted"
            loading={disconnecting}
            onClick={onDisconnect}
          >
            <LogOut size={13} /> Disconnect
          </Button>
        ) : null}
      </HStack>
    </VStack>
  );
}

/** Pending state: the one-time code, the OpenAI link, and the poll spinner. */
function PendingApprovalPanel({
  pending,
  onCancel,
}: {
  pending: Extract<CodexSignInPhase, { name: "pending" }>;
  onCancel: () => void;
}) {
  return (
    <VStack align="stretch" gap={3} data-testid="codex-pending">
      <Text fontSize="sm">Enter this code on OpenAI's device page to approve the sign-in:</Text>
      <HStack justify="space-between" gap={3} flexWrap="wrap">
        <Text
          fontSize="2xl"
          fontWeight="700"
          fontFamily="mono"
          letterSpacing="0.12em"
          aria-label="One-time sign-in code"
        >
          {pending.userCode}
        </Text>
        <Button asChild size="sm" colorPalette="orange">
          {/* The link recipe's own text colour would override the solid
              button's white label, and Langy's leave-confirmation dialog
              would stop a click on a button we authored ourselves: the
              first-party marker lets it open directly. */}
          <Link
            href={pending.verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
            color="white"
            _hover={{ textDecoration: "none", color: "white" }}
            {...langyFirstPartyLinkProps}
          >
            Open openai.com <ExternalLink size={13} />
          </Link>
        </Button>
      </HStack>
      <HStack gap={2} color="fg.muted" data-testid="codex-waiting">
        <Spinner size="xs" />
        <Text fontSize="xs">Waiting for you to approve in the browser…</Text>
        <Button size="2xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </HStack>
    </VStack>
  );
}

function failureCodeOf({ timedOut }: { timedOut: boolean }) {
  return timedOut ? "codex_sign_in_timed_out" : "codex_sign_in_failed";
}

function startLabel(phase: CodexSignInPhase): string {
  if (phase.name === "error" && phase.timedOut) return "Start sign-in again";
  return "Sign in with OpenAI";
}

/** Copies the one-time code and confirms with a check. */
function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      aria-label={copied ? "Code copied" : "Copy code"}
      title="Copy code"
      variant="ghost"
      size="sm"
      borderRadius="8px"
      color={copied ? "green.fg" : "fg.subtle"}
      _hover={{ bg: "bg.muted", color: copied ? "green.fg" : "fg" }}
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => setCopied(true));
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </IconButton>
  );
}

/** Onboarding's dark, full-width ChatGPT button with the OpenAI mark. */
function GuidedSignInButton({
  connected,
  disabled,
  onStart,
}: {
  connected: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <Button
      onClick={onStart}
      disabled={connected || disabled}
      w="full"
      h="44px"
      borderRadius="12px"
      fontSize="13.5px"
      fontWeight="600"
      gap={2.5}
      bg="fg"
      color="bg.panel"
      _hover={{ opacity: 0.9 }}
      _disabled={{ opacity: 0.7, cursor: "not-allowed" }}
    >
      <Box
        w="16px"
        h="16px"
        flexShrink={0}
        aria-hidden="true"
        css={{ "& > svg": { w: "full", h: "full", fill: "currentColor" } }}
      >
        {modelProviderIcons.openai}
      </Box>
      {connected ? "Signed in" : "Sign in with ChatGPT"}
    </Button>
  );
}

/** The waiting row that replaces the button: a spinner, the status and a Cancel. */
function GuidedWaitingRow({ onCancel }: { onCancel: () => void }) {
  return (
    <HStack justify="space-between" gap={3} data-testid="codex-waiting">
      <HStack as="output" gap={2} minW={0} color="fg.muted">
        <Spinner size="xs" flexShrink={0} />
        <Text fontSize="13.5px" fontWeight="500">
          Waiting for ChatGPT…
        </Text>
      </HStack>
      <Button
        variant="outline"
        onClick={onCancel}
        h="36px"
        px={4}
        borderRadius="10px"
        border="1px solid"
        borderColor="border"
        bg="bg.panel"
        color="fg.muted"
        fontSize="12.5px"
        fontWeight="600"
        flexShrink={0}
        _hover={{ bg: "bg.muted", color: "fg" }}
      >
        Cancel
      </Button>
    </HStack>
  );
}

/** The one-time code with its copy button, and the link to OpenAI's device page. */
function GuidedPendingCode({
  pending,
}: {
  pending: Extract<CodexSignInPhase, { name: "pending" }>;
}) {
  return (
    <VStack align="stretch" gap={5} mt={1} data-testid="codex-pending">
      <Text fontSize="12.5px" color="fg.muted">
        Enter this code on OpenAI's device page to approve the sign-in:
      </Text>
      <HStack justify="space-between" gap={3} wrap="wrap">
        <HStack gap={1} minW={0}>
          <Text
            fontSize="2xl"
            fontWeight="700"
            fontFamily="mono"
            letterSpacing="0.12em"
            aria-label="One-time sign-in code"
          >
            {pending.userCode}
          </Text>
          <CopyCodeButton code={pending.userCode} />
        </HStack>
        <Button asChild size="sm" colorPalette="orange">
          <Link
            href={pending.verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
            color="white"
            _hover={{ textDecoration: "none", color: "white" }}
            {...langyFirstPartyLinkProps}
          >
            Open openai.com
          </Link>
        </Button>
      </HStack>
    </VStack>
  );
}

/** Onboarding's Codex panel body: error, the button or the waiting row, then the code. */
function GuidedCodexActions({
  signIn,
  disabled,
}: {
  signIn: ReturnType<typeof useCodexDeviceSignIn>;
  disabled: boolean;
}) {
  const { phase } = signIn;
  const waiting = phase.name === "starting" || phase.name === "pending";
  return (
    <VStack align="stretch" gap={4} width="full">
      {phase.name === "error" && (
        <Text fontSize="11.5px" color="fg.error" role="alert">
          {phase.message}
        </Text>
      )}
      {waiting ? (
        <GuidedWaitingRow onCancel={signIn.cancel} />
      ) : (
        <GuidedSignInButton
          connected={phase.name === "complete"}
          disabled={disabled}
          onStart={() => void signIn.begin()}
        />
      )}
      {phase.name === "pending" && <GuidedPendingCode pending={phase} />}
    </VStack>
  );
}

/** Idle / starting / error state: the pitch line and the sign-in button. */
function StartPanel({ phase, onStart }: { phase: CodexSignInPhase; onStart: () => void }) {
  return (
    <VStack align="stretch" gap={2}>
      {phase.name === "error" ? (
        <Text fontSize="xs" color="fg.error">
          {phase.message}
        </Text>
      ) : (
        <Text fontSize="xs" color="fg.muted">
          Sign in with your OpenAI account and Codex runs on your ChatGPT plan. No API key needed.
        </Text>
      )}
      <Box>
        <Button
          size="sm"
          colorPalette="orange"
          loading={phase.name === "starting"}
          onClick={onStart}
        >
          {startLabel(phase)}
        </Button>
      </Box>
    </VStack>
  );
}
