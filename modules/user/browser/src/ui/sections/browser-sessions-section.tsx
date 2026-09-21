/**
 * Where you are signed in: the browsers holding a live sign-in to this
 * account, and the one way to end one of them without ending them all.
 */

import { Badge, Button, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { nowInstant } from "@langwatch/time";
import { Monitor } from "lucide-react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { browserSessionLabel, isSessionStale } from "../../model/browser-session.ts";
import { readableDate } from "../../model/display-formatters.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";

export function BrowserSessionsSection() {
  const host = usePersonalWorkspaceHost();
  const sessions = api.user.browserSessions.useQuery({});
  const endSession = api.user.endBrowserSession.useMutation();
  const utils = api.useUtils();

  const end = async (sessionId: string) => {
    try {
      await endSession.mutateAsync({ sessionId });
      await utils.user.browserSessions.invalidate();
      host.succeeded({ title: "Signed that browser out" });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't sign that browser out" });
    }
  };

  const listed = sessions.data ?? [];
  const now = nowInstant();

  return (
    <VStack align="start" gap={4} width="full" data-testid="browser-sessions-section">
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <Monitor size={18} />
          <Text fontWeight={600}>Where you are signed in</Text>
        </HStack>
        <Text color="fg.muted" fontSize="sm">
          End a browser you no longer use, or one you do not recognize. Signing out of this one uses
          the sign-out control.
        </Text>
      </VStack>

      {sessions.isLoading && <Spinner size="sm" />}

      {!sessions.isLoading && listed.length === 0 && (
        <Text fontSize="sm" color="fg.muted">
          No other browsers hold a sign-in to this account.
        </Text>
      )}

      <VStack align="stretch" gap={2} width="full">
        {listed.map((session) => (
          <HStack key={session.sessionId} width="full" gap={3} alignItems="start">
            <Monitor size={16} />
            <VStack align="start" gap={0}>
              <HStack gap={2}>
                <Text fontSize="sm">{browserSessionLabel(session.userAgent)}</Text>
                {session.current && (
                  <Badge colorPalette="green" size="sm">
                    This browser
                  </Badge>
                )}
                {!session.current &&
                  isSessionStale({ lastActiveAt: session.lastActiveAt, now }) && (
                    <Badge colorPalette="orange" size="sm">
                      Not used lately
                    </Badge>
                  )}
              </HStack>
              <Text fontSize="xs" color="fg.muted">
                {session.method}
                {session.secondFactorProven ? " with two-step verification" : ""} ·{" "}
                {session.ipAddress ?? "address unknown"} · last used{" "}
                {readableDate(session.lastActiveAt).toLocaleDateString()}
              </Text>
            </VStack>
            <Spacer />
            {!session.current && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => void end(session.sessionId)}
                disabled={endSession.isPending}
              >
                Sign out
              </Button>
            )}
          </HStack>
        ))}
      </VStack>
    </VStack>
  );
}
