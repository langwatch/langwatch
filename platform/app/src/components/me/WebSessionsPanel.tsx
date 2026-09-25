import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Globe } from "lucide-react";

import { api } from "~/utils/api";

import { formatRelativeTime } from "./relativeTime";

/**
 * Where this person is signed in on the web, and how each sign-in got in
 * (D06).
 *
 * It sits with the CLI devices rather than in a page of its own, because a
 * browser and a terminal are two ways of being the same person and somebody
 * checking what is signed in should not have to know which page holds which.
 *
 * Two things each entry says that it could not before: the method it signed
 * in with, and whether a second factor was proved. The second is deliberately
 * quiet — an entry that proved nothing reads as an ordinary sign-in and not
 * as a warning, because every session minted before this shipped is one and
 * telling people their normal sign-in is a problem would be false.
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
              {/* Said as a fact about the sign-in, not as a verdict on it. */}
              {session.secondFactorProven
                ? "Second factor proven at sign-in"
                : "No second factor at sign-in"}
              {" · "}
              Signed in{" "}
              {formatRelativeTime(new Date(session.signedInAt).getTime())}
            </Text>
          </VStack>
        </HStack>
      ))}
    </VStack>
  );
}
