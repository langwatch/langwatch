import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Check, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";
import { showErrorToast } from "~/features/errors";
import type { ScopeAssignment } from "~/server/scopes/scope.types";
import { api } from "~/utils/api";
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../ui/dialog";
import { Link } from "../ui/link";
import { toaster } from "../ui/toaster";
import {
  type CodexSignInPhase,
  useCodexDeviceSignIn,
} from "./useCodexDeviceSignIn";

/**
 * Sign in with your OpenAI account — the Codex provider's whole credential
 * UI, shared verbatim by the settings drawer, Langy's inline setup and the
 * onboarding step (spec: specs/model-providers/codex-account-provider.feature).
 *
 * The flow is OpenAI's device authorization: show a one-time code, open
 * their verification page, poll until the user approves there. Nothing is
 * typed into LangWatch and nothing persists until the poll completes
 * server-side (which is also where the provider row + optional coding
 * defaults are written). The state machine lives in `useCodexDeviceSignIn`;
 * this file only renders its phases.
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
  // The settings flow does NOT write coding defaults during sign-in
  // (setAsCodingDefaults is false there); it asks with a dialog once the
  // account connects, and applies the same role defaults on "yes".
  const [askDefaults, setAskDefaults] = useState(false);
  const signIn = useCodexDeviceSignIn({
    projectId,
    scopes,
    setAsCodingDefaults,
    onConnected: (account) => {
      if (!setAsCodingDefaults) setAskDefaults(true);
      onConnected?.(account);
    },
  });
  const { phase, connected } = signIn;

  const defaultsDialog = (
    <CodexCodingDefaultsDialog
      open={askDefaults}
      projectId={projectId}
      scopes={scopes}
      onClose={() => setAskDefaults(false)}
    />
  );

  if (connected && phase.name !== "pending" && phase.name !== "starting") {
    return (
      <>
        <ConnectedPanel
          account={connected}
          canDisconnect={!!signIn.storedProviderId}
          disconnecting={signIn.disconnecting}
          onReauthenticate={() => void signIn.begin()}
          onDisconnect={signIn.disconnect}
        />
        {defaultsDialog}
      </>
    );
  }
  if (phase.name === "pending") {
    return <PendingApprovalPanel pending={phase} onCancel={signIn.cancel} />;
  }
  return <StartPanel phase={phase} onStart={() => void signIn.begin()} />;
}

/**
 * Post-connect ask on the settings surface: point the coding-assistant
 * roles (Langy + the fast assists) at the just-connected codex model. The
 * Langy and onboarding flows do this inline during sign-in; settings asks
 * first because someone adding a provider row is not necessarily choosing
 * their org's defaults.
 */
function CodexCodingDefaultsDialog({
  open,
  projectId,
  scopes,
  onClose,
}: {
  open: boolean;
  projectId: string;
  scopes: ScopeAssignment[];
  onClose: () => void;
}) {
  const apply = api.modelProvider.codexApplyCodingDefaults.useMutation();
  const utils = api.useUtils();

  return (
    <DialogRoot open={open} onOpenChange={(e) => !e.open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Codex as your coding default?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Text fontSize="sm">
            Langy and the fast AI assists (search, chat titles, autocomplete,
            translations) across LangWatch will run on this OpenAI account's
            plan. The playground, evaluations and workflows keep their current
            models.
          </Text>
        </DialogBody>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button
            size="sm"
            colorPalette="orange"
            loading={apply.isLoading}
            onClick={() =>
              void apply
                .mutateAsync({ projectId, scopes })
                .then(async () => {
                  await utils.modelProvider.invalidate();
                  toaster.create({
                    title: "Codex set as the Langy and Fast default",
                    type: "success",
                  });
                  onClose();
                })
                .catch((error: unknown) => {
                  showErrorToast({
                    error,
                    fallbackTitle: "Couldn't set the defaults",
                  });
                })
            }
          >
            Set as default
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
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
        Langy and the AI assists run on this account's plan. Usage counts
        against your OpenAI subscription limits, not API credits.
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
      <Text fontSize="sm">
        Enter this code on OpenAI's device page to approve the sign-in:
      </Text>
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
          <Link
            href={pending.verificationUrl}
            isExternal
            _hover={{ textDecoration: "none" }}
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
function StartPanel({
  phase,
  onStart,
}: {
  phase: CodexSignInPhase;
  onStart: () => void;
}) {
  return (
    <VStack align="stretch" gap={2}>
      {phase.name === "error" ? (
        <Text fontSize="xs" color="fg.error">
          {phase.message}
        </Text>
      ) : (
        <Text fontSize="xs" color="fg.muted">
          Sign in with your OpenAI account and Codex runs on your ChatGPT plan.
          No API key needed.
        </Text>
      )}
      <Box>
        <Button
          size="sm"
          colorPalette="orange"
          loading={phase.name === "starting"}
          onClick={onStart}
        >
          {phase.name === "error" && phase.timedOut
            ? "Start sign-in again"
            : "Sign in with OpenAI"}
        </Button>
      </Box>
    </VStack>
  );
}
