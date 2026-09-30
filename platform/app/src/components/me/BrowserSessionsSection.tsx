import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Monitor } from "lucide-react";
import { SettingsRowsSkeleton } from "~/components/settings/kit/SettingsSkeleton";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { IdentityChip } from "../access/IdentityRow";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import {
  SettingsSection,
  SettingsSectionRow,
} from "../settings/SettingsSection";
import { toaster } from "../ui/toaster";
import { formatRelativeTime } from "./relativeTime";
import { isSessionStale, userAgentLabel } from "./userAgentLabel";

/**
 * The browsers this account is signed in on, and the way to end one.
 *
 * The question people arrive with is "is one of these not me", and until now
 * the list could not answer it: it said how each session signed in and when,
 * and nothing about WHERE. A browser and an operating system are what somebody
 * recognises about the laptop they left at the office, and both were already
 * stored on the session row and thrown away before the screen saw them.
 *
 * ONE ROW ENDS ONE SESSION. Ending every session a method minted already
 * existed and is the wrong instrument for this: somebody looking at a machine
 * they no longer have wants that machine gone, not every sign-in that used the
 * same password. The session doing the reading carries no such control — it
 * is marked as this browser instead, because ending it is signing out and that
 * has its own control elsewhere.
 *
 * ACTIVITY IS KNOWN TO THE DAY. A live session's row is rolled once a day, so
 * "last active" is honest at that resolution and the quiet chip only appears
 * after a fortnight of nothing. It is a prompt to look, never a verdict: an
 * old session is not a compromised one, and saying otherwise would make every
 * chip on the page less believable.
 *
 * Spec: specs/settings/profile.feature
 */
export function BrowserSessionsSection() {
  const sessions = api.personalSessions.listWebSessions.useQuery({});
  const utils = api.useUtils();

  const revoke = api.personalSessions.revokeWebSession.useMutation({
    onSuccess: async () => {
      await utils.personalSessions.listWebSessions.invalidate();
      toaster.create({ title: "Signed that browser out", type: "success" });
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't sign that browser out",
      }),
  });

  return (
    <SettingsSection
      icon={<Monitor size={18} />}
      title="Where you are signed in"
      description="The browsers holding a live sign-in to this account."
      testId="browser-sessions-settings-section"
    >
      {sessions.isError ? (
        <SectionErrorNotice
          error={sessions.error}
          fallbackTitle="Couldn't read where you are signed in"
        />
      ) : sessions.isLoading ? (
        <SettingsRowsSkeleton rows={2} />
      ) : (sessions.data ?? []).length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          Nothing is signed in but the browser you are reading this in.
        </Text>
      ) : (
        <VStack align="stretch" gap={2} width="full">
          {(sessions.data ?? []).map((session) => (
            <SessionRow
              key={session.sessionId}
              session={session}
              isRevoking={
                revoke.isPending &&
                revoke.variables?.sessionId === session.sessionId
              }
              onRevoke={() => revoke.mutate({ sessionId: session.sessionId })}
            />
          ))}
        </VStack>
      )}
    </SettingsSection>
  );
}

/** One browser: what it is, when it last did anything, and what to do about it. */
function SessionRow({
  session,
  isRevoking,
  onRevoke,
}: {
  session: {
    sessionId: string;
    method: string;
    userAgent: string | null;
    signedInAt: string | Date;
    lastActiveAt: string | Date;
    current: boolean;
  };
  isRevoking: boolean;
  onRevoke: () => void;
}) {
  const lastActiveAt = new Date(session.lastActiveAt);
  const stale =
    !session.current && isSessionStale({ lastActiveAt, now: new Date() });

  return (
    <SettingsSectionRow testId="browser-session-row">
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <HStack gap={2} flexWrap="wrap">
          <Text fontSize="sm" fontWeight={500}>
            {userAgentLabel(session.userAgent)}
          </Text>
          {session.current && (
            <IdentityChip
              label="This browser"
              tone="good"
              data-testid="current-session-chip"
            />
          )}
          {stale && (
            <IdentityChip
              label="Not used lately"
              title="Nothing has happened on this browser for a fortnight. That is not a problem on its own, but it is worth a look."
              data-testid="stale-session-chip"
            />
          )}
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          {session.method}
          {" · "}
          Signed in {formatRelativeTime(new Date(session.signedInAt).getTime())}
          {!session.current && (
            <>
              {" · "}
              Last active {formatRelativeTime(lastActiveAt.getTime())}
            </>
          )}
        </Text>
      </VStack>

      {/* The browser reading this carries no control: ending it is signing
          out, which is a different act with its own button. */}
      {!session.current && (
        <Button
          size="xs"
          variant="outline"
          loading={isRevoking}
          aria-label={`Sign out ${userAgentLabel(session.userAgent)}`}
          onClick={onRevoke}
        >
          Sign out
        </Button>
      )}
    </SettingsSectionRow>
  );
}
