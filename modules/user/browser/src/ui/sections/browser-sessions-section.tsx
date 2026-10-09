/**
 * Where you are signed in: the browsers holding a live sign-in to this
 * account, and the one way to end one of them without ending them all.
 */

import { Badge, Button, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { SettingsSection, SettingsSectionRow } from "@langwatch/design-system/settings-section";
import { nowInstant, toEpochMs } from "@langwatch/time";
import { Monitor } from "lucide-react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { browserSessionLabel, isSessionStale } from "../../model/browser-session.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import { formatRelativeTime } from "../../model/relative-time.ts";

export function BrowserSessionsSection() {
  const host = usePersonalWorkspaceHost();
  const sessions = api.auth.browserSessions.useQuery({});
  const endSession = api.auth.endBrowserSession.useMutation();
  const utils = api.useUtils();

  const end = async (sessionId: string) => {
    try {
      await endSession.mutateAsync({ sessionId });
      await utils.auth.browserSessions.invalidate();
      host.succeeded({ title: "Signed that browser out" });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't sign that browser out" });
    }
  };

  const listed = sessions.data ?? [];
  const now = nowInstant();

  return (
    <SettingsSection
      icon={<Monitor size={18} />}
      title="Where you are signed in"
      hint="The browsers holding a live sign-in to this account."
      data-testid="browser-sessions-settings-section"
    >
      {sessions.isLoading && <Spinner size="sm" />}
      {!sessions.isLoading && listed.length === 0 && (
        <Text fontSize="sm" color="fg.muted">
          Nothing is signed in but the browser you are reading this in.
        </Text>
      )}
      {listed.length > 0 && (
        <VStack align="stretch" gap={2} width="full">
          {listed.map((session) => (
            <SettingsSectionRow key={session.sessionId} data-testid="browser-session-row">
              <VStack align="start" gap={0} flex={1} minWidth={0}>
                <HStack gap={2} flexWrap="wrap">
                  <Text fontSize="sm" fontWeight={500}>
                    {browserSessionLabel(session.userAgent)}
                  </Text>
                  {session.current && (
                    <Badge colorPalette="green" size="sm" data-testid="current-session-chip">
                      This browser
                    </Badge>
                  )}
                  {!session.current &&
                    isSessionStale({ lastActiveAt: session.lastActiveAt, now }) && (
                      <Badge colorPalette="orange" size="sm" data-testid="stale-session-chip">
                        Not used lately
                      </Badge>
                    )}
                </HStack>
                <Text fontSize="xs" color="fg.muted">
                  {session.method}
                  {session.secondFactorProven ? " with two-step verification" : ""} · Signed in{" "}
                  {formatRelativeTime(toEpochMs(session.signedInAt))}
                  {!session.current &&
                    ` · Last active ${formatRelativeTime(toEpochMs(session.lastActiveAt))}`}
                </Text>
              </VStack>
              {!session.current && (
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={`Sign out ${browserSessionLabel(session.userAgent)}`}
                  onClick={() => void end(session.sessionId)}
                  disabled={endSession.isPending}
                >
                  Sign out
                </Button>
              )}
            </SettingsSectionRow>
          ))}
        </VStack>
      )}
    </SettingsSection>
  );
}
