import { Box, Button, HStack, Link, Spinner, Text, VStack } from "@chakra-ui/react";
import { Check, ExternalLink, LogOut, RefreshCw } from "lucide-react";

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
  projectId,
  scopes,
  setAsCodingDefaults,
  onConnected,
}: {
  projectId: string;
  /** Where the provider row saves — callers pass the widest manageable scope. */
  scopes: ScopeAssignment[];
  /** Langy setup + onboarding pass true: also point Langy and the tiny
   *  assists at the codex model. Settings passes false. */
  setAsCodingDefaults: boolean;
  onConnected?: (account: { email: string; plan: string }) => void;
}) {
  const signIn = useCodexDeviceSignIn({
    projectId,
    scopes,
    setAsCodingDefaults,
    onConnected,
  });
  const { phase, connected } = signIn;

  if (connected && phase.name !== "pending" && phase.name !== "starting") {
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
    <VStack align="stretch" gap={3}>
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
      <HStack gap={2} color="fg.muted">
        <Spinner size="xs" />
        <Text fontSize="xs">Waiting for you to approve in the browser…</Text>
        <Button size="2xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </HStack>
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
          {phase.name === "error" && phase.timedOut ? "Start sign-in again" : "Sign in with OpenAI"}
        </Button>
      </Box>
    </VStack>
  );
}
