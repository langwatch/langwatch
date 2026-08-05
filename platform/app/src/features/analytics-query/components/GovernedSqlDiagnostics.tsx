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
 * Rendered outside the mode tabs by {@link GovernedSqlResultPane}, so a chart
 * can never be the reason a warning about its own data went unread.
 *
 * @see ~/server/analytics/governed-sql/diagnostics.ts
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { Alert, Stack, Text } from "@chakra-ui/react";

import type { GovernedSqlDiagnostic } from "~/server/analytics/governed-sql";

/** The one code whose meaning is "what you are reading is incomplete". */
const TRUNCATION_CODE = "RESULT_TRUNCATED";

export interface GovernedSqlDiagnosticsProps {
  diagnostics: readonly GovernedSqlDiagnostic[];
}

export function GovernedSqlDiagnostics({
  diagnostics,
}: GovernedSqlDiagnosticsProps) {
  if (diagnostics.length === 0) return null;

  return (
    <Stack gap={2} width="full" data-testid="governed-sql-diagnostics">
      {diagnostics.map((diagnostic, index) => {
        const severity =
          diagnostic.code === TRUNCATION_CODE ? "warning" : "info";
        return (
          <Alert.Root
            key={`${diagnostic.code}-${index}`}
            status={severity}
            data-testid="governed-sql-diagnostic"
            data-diagnostic-code={diagnostic.code}
            // Chakra carries the status in React context rather than in the
            // document, so the same value is published here — one expression
            // feeding both, so the attribute cannot drift from the styling.
            data-severity={severity}
          >
            <Alert.Indicator />
            <Alert.Content>
              {/* Unchanged: each message already names the fact that made it
                fire, and that is the part a shortened version would drop. */}
              <Text fontSize="12.5px">{diagnostic.message}</Text>
            </Alert.Content>
          </Alert.Root>
        );
      })}
    </Stack>
  );
}
