/**
 * The notes the backend attached to a result.
 *
 * Three rules, and each of them is a way this could quietly stop being useful:
 *
 *  - **every** diagnostic is rendered. The API under-reports by design, so a
 *    surface that filtered them further would leave a member with neither the
 *    warning nor a reason to doubt the answer;
 *  - the message is rendered **unchanged**. Each one already names the fact
 *    that made it fire, and a shortened version would drop exactly that;
 *  - truncation is **visually prominent**. It is the one diagnostic that says
 *    the numbers on screen are not the whole answer, so it is a warning while
 *    the rest are informational.
 *
 * Rendered outside the mode tabs by {@link LangWatchQLResultPane}, so a chart
 * can never be the reason a warning about its own data went unread.
 *
 * @see ~/server/analytics/lwql/diagnostics.ts
 * @see specs/analytics/lwql-workbench.feature
 */

import { HStack, Stack, Text } from "@chakra-ui/react";

import type { LangWatchQLDiagnostic } from "~/server/analytics/lwql";

/** The one code whose meaning is "what you are reading is incomplete". */
const TRUNCATION_CODE = "RESULT_TRUNCATED";

export interface LangWatchQLDiagnosticsProps {
  diagnostics: readonly LangWatchQLDiagnostic[];
}

export function LangWatchQLDiagnostics({ diagnostics }: LangWatchQLDiagnosticsProps) {
  if (diagnostics.length === 0) return null;

  return (
    <Stack gap={0} width="full" data-testid="lwql-diagnostics">
      {diagnostics.map((diagnostic, index) => {
        const severity = diagnostic.code === TRUNCATION_CODE ? "warning" : "info";
        return (
          <HStack
            key={`${diagnostic.code}-${index}`}
            align="flex-start"
            gap={2}
            paddingX={4}
            paddingY={2}
            borderBottomWidth="1px"
            borderColor="border"
            background="bg.subtle"
            data-testid="lwql-diagnostic"
            data-diagnostic-code={diagnostic.code}
            // One expression feeding both the label and this attribute, so the
            // published severity cannot drift from the styling.
            data-severity={severity}
          >
            <Text
              flexShrink={0}
              fontSize="10.5px"
              fontWeight="700"
              letterSpacing="0.05em"
              textTransform="uppercase"
              color={severity === "warning" ? "orange.fg" : "blue.fg"}
              marginTop="1px"
            >
              {severity === "warning" ? "Warning" : "Notice"}
            </Text>
            {/* Unchanged: each message already names the fact that made it
                fire, and that is the part a shortened version would drop. */}
            <Text fontSize="11.5px" lineHeight="1.55" color="fg.muted">
              {diagnostic.message}
            </Text>
          </HStack>
        );
      })}
    </Stack>
  );
}
