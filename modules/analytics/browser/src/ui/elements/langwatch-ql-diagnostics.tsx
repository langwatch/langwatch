/**
 * The notes the backend attached to a result, rendered unfiltered and
 * unchanged: the API already under-reports, so shortening would drop
 * exactly the information that matters. A result is never cut, so none is a warning.
 * @see @langwatch/analytics-contract/diagnostics.ts
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */

import { HStack, Stack, Text } from "@chakra-ui/react";
import type { LangWatchQLDiagnostic } from "@langwatch/analytics-contract";

export interface LangWatchQLDiagnosticsProps {
  diagnostics: readonly LangWatchQLDiagnostic[];
}

export function LangWatchQLDiagnostics({ diagnostics }: LangWatchQLDiagnosticsProps) {
  if (diagnostics.length === 0) return null;

  return (
    <Stack gap={0} width="full" data-testid="lwql-diagnostics">
      {diagnostics.map((diagnostic, index) => {
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
          >
            <Text
              flexShrink={0}
              fontSize="10.5px"
              fontWeight="700"
              letterSpacing="0.05em"
              textTransform="uppercase"
              color="blue.fg"
              marginTop="1px"
            >
              Notice
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
