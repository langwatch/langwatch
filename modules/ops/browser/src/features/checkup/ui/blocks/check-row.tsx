import { Badge, HStack, Link, Text, VStack } from "@chakra-ui/react";
import { resolveUiFailureCopy } from "@langwatch/browser-host/feedback";
import type { CheckRow as CheckRowData } from "@langwatch/ops-contract";
import { ExternalLink } from "lucide-react";

import { CheckupSectionRow } from "../elements/checkup-section.tsx";

const DOCS_BASE = "https://docs.langwatch.ai";

/**
 * One row of the checkup with its verdict. A check that could not run is
 * grey on purpose: it is not a check that passed.
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
export function CheckRow({ row }: { row: CheckRowData }) {
  const verdict = row.verdict;
  const fix = fixOf(verdict);

  return (
    <CheckupSectionRow testId={`checkup-row-${row.id}`}>
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
    </CheckupSectionRow>
  );
}

/** Pass, fail or not checked, in that vocabulary and no other. */
export function VerdictBadge({ outcome }: { outcome: CheckRowData["verdict"]["outcome"] }) {
  switch (outcome) {
    case "verified":
      return (
        <Badge colorPalette="green" size="sm" variant="surface" data-outcome="verified">
          Pass
        </Badge>
      );
    case "refused":
      return (
        <Badge colorPalette="red" size="sm" variant="surface" data-outcome="refused">
          Fail
        </Badge>
      );
    default:
      return (
        <Badge colorPalette="gray" size="sm" variant="surface" data-outcome="unchecked">
          Not checked
        </Badge>
      );
  }
}

/**
 * The registry's copy for a refusal whose code it explains, so it reads the
 * same as anywhere else in the app; the check's own words otherwise.
 */
function fixOf(verdict: CheckRowData["verdict"]): string | undefined {
  if (verdict.outcome === "verified") return void 0;
  if (verdict.outcome === "unchecked") return verdict.fix;
  const copy = resolveUiFailureCopy({
    error: { code: verdict.code, httpStatus: 0, meta: verdict.meta ?? {} },
    fallbackTitle: verdict.detail,
    description: verdict.fix,
  });
  return copy.description || verdict.fix;
}
