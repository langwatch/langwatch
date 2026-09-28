import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import { toEpochMs } from "@langwatch/time";
import { Globe } from "lucide-react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { formatRelativeTime } from "../../model/relative-time.ts";

/**
 * Where this person is signed in on the web, and how each sign-in got in. An
 * entry that proved no second factor reads as ordinary, never as a warning.
 */
export function WebSessionsPanel() {
  const sessions = api.personalSessions.listWebSessions.useQuery({});

  if (sessions.isLoading) {
    return (
      <Text fontSize="sm" color="fg.muted" paddingY={4}>
        Loading browser sign-ins…
      </Text>
    );
  }

  const entries = sessions.data ?? [];
  if (entries.length === 0) return null;

  return (
    <VStack align="stretch" gap={2} data-testid="web-sessions">
      <Text fontSize="sm" fontWeight="500">
        Browser sign-ins
      </Text>
      {entries.map((session) => (
        <HStack
          key={session.sessionId}
          gap={3}
          paddingY={2}
          paddingX={3}
          borderWidth="1px"
          borderColor="border"
          borderRadius="sm"
          data-testid="web-session-row"
        >
          <Box color="fg.muted">
            <Globe size={16} />
          </Box>
          <VStack align="start" gap={0} flex={1}>
            <HStack gap={2}>
              <Text fontSize="sm">{session.method}</Text>
              {session.current && (
                <Badge size="sm" colorPalette="green">
                  This device
                </Badge>
              )}
            </HStack>
            <Text fontSize="xs" color="fg.muted">
              {session.secondFactorProven
                ? "Second factor proven at sign-in"
                : "No second factor at sign-in"}
              {" · "}
              Signed in {formatRelativeTime(toEpochMs(session.signedInAt))}
            </Text>
          </VStack>
        </HStack>
      ))}
    </VStack>
  );
}
