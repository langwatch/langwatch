import { Badge, HStack, Link, Text, VStack } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";

import { SettingsSectionRow } from "~/components/settings/SettingsSection";
import { explainHandledError } from "~/features/errors/logic/presentation";
import type { CheckRow as CheckRowData } from "~/server/checkup/verdict";

const DOCS_BASE = "https://docs.langwatch.ai";

/**
 * One row of the checkup, with its verdict
 * (specs/self-hosting/checkup/checkup.feature).
 *
 * Three verdicts, three colours, and the third is grey on purpose: a check
 * that could not run is not a check that passed, and a page that painted it
 * green would be telling the operator something it does not know.
 */
export function CheckRow({ row }: { row: CheckRowData }) {
  const verdict = row.verdict;
  const fix = fixCopy(row);

  return (
    <SettingsSectionRow testId={`checkup-row-${row.id}`}>
      <VStack align="start" gap={1} width="full">
        <HStack width="full" justify="space-between" align="start">
          <Text fontWeight="medium">{row.name}</Text>
          <VerdictBadge outcome={verdict.outcome} />
        </HStack>
        <Text fontSize="sm" color="fg.muted">
          {verdict.detail}
        </Text>
        {fix ? (
          <Text fontSize="sm" data-testid={`checkup-fix-${row.id}`}>
            {fix}
          </Text>
        ) : null}
        {verdict.outcome !== "verified" && verdict.docsPath ? (
          <Link
            href={`${DOCS_BASE}${verdict.docsPath}`}
            target="_blank"
            rel="noopener noreferrer"
            fontSize="sm"
            color="blue.600"
          >
            Read more <ExternalLink size={12} />
          </Link>
        ) : null}
      </VStack>
    </SettingsSectionRow>
  );
}

/** Pass, fail or not checked, in that vocabulary and no other. */
export function VerdictBadge({
  outcome,
}: {
  outcome: CheckRowData["verdict"]["outcome"];
}) {
  switch (outcome) {
    case "verified":
      return (
        <Badge
          colorPalette="green"
          size="sm"
          variant="surface"
          data-outcome="verified"
        >
          Pass
        </Badge>
      );
    case "refused":
      return (
        <Badge
          colorPalette="red"
          size="sm"
          variant="surface"
          data-outcome="refused"
        >
          Fail
        </Badge>
      );
    default:
      return (
        <Badge
          colorPalette="gray"
          size="sm"
          variant="surface"
          data-outcome="unchecked"
        >
          Not checked
        </Badge>
      );
  }
}

/**
 * The fix, from the presentation registry where the code has one, so a
 * refusal the rest of the app already knows how to explain reads the same
 * here; the check's own words otherwise.
 */
function fixCopy(row: CheckRowData): string | null {
  const verdict = row.verdict;
  if (verdict.outcome === "verified") return null;
  if (verdict.outcome === "unchecked") return verdict.fix ?? null;

  const explained = explainHandledError({
    code: verdict.code,
    meta: verdict.meta ?? {},
    httpStatus: 0,
    fault: "customer",
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });
  if (explained.isRegistered && explained.description) {
    return explained.description;
  }
  return verdict.fix;
}
