import { Heading, Table, Text, VStack } from "@chakra-ui/react";
import {
  CONTENT_CATEGORIES,
  type DataPrivacySnapshot,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { CATEGORY_LABELS, DISPOSITION_LABELS, PII_LABELS } from "../../model/data-privacy-labels";

/**
 * What is ACTUALLY applied once the rules above cascade down.
 *
 * The scope selection is declared structurally rather than imported from
 * `@langwatch/authz-web`: this block reads three fields off it, and naming that
 * package here would add a second closure finding to the family for a shape
 * narrower than the import.
 */
export type EffectiveScopeSelection =
  | { kind: "all" }
  | { kind: "team-current" }
  | { kind: "project-current" }
  | { kind: "specific"; scopeType: string; scopeId: string; name?: string };

/**
 * The effective view follows the scope filter: "All you can see" shows the
 * organization baseline, "This team" the team baseline, and a project the full
 * cascade. Team/org baselines are null for a personal-account project, which
 * falls back to its own project policy.
 */
export function pickEffectiveForScope(
  snapshot: DataPrivacySnapshot,
  scopeFilter: EffectiveScopeSelection,
  currentTeamId: string | null,
): { effective: ResolvedDataPrivacy; scopeLabel: string } {
  if (scopeFilter.kind === "all" && snapshot.effectiveOrganization) {
    return {
      effective: snapshot.effectiveOrganization,
      scopeLabel: "this organization",
    };
  }
  const isCurrentTeam =
    scopeFilter.kind === "team-current" ||
    (scopeFilter.kind === "specific" &&
      scopeFilter.scopeType === "TEAM" &&
      scopeFilter.scopeId === currentTeamId);
  if (isCurrentTeam && snapshot.effectiveTeam) {
    return { effective: snapshot.effectiveTeam, scopeLabel: "this team" };
  }
  return { effective: snapshot.effective, scopeLabel: "this project" };
}

export function EffectiveSummary({
  snapshot,
  scopeFilter,
  currentTeamId,
}: {
  snapshot: DataPrivacySnapshot;
  scopeFilter: EffectiveScopeSelection;
  currentTeamId: string | null;
}) {
  const { effective, scopeLabel } = pickEffectiveForScope(snapshot, scopeFilter, currentTeamId);
  const piiValue =
    effective.pii.level === "custom"
      ? `Custom (${effective.pii.entities.length} ${
          effective.pii.entities.length === 1 ? "type" : "types"
        })`
      : PII_LABELS[effective.pii.level];
  const secretsValue = `${effective.secrets.enabled ? "On" : "Off"}${
    effective.secrets.customPatterns.length > 0
      ? ` · ${effective.secrets.customPatterns.length} custom ${
          effective.secrets.customPatterns.length === 1 ? "pattern" : "patterns"
        }`
      : ""
  }`;
  const effectiveRows: Array<{ term: string; value: string }> = [
    ...CONTENT_CATEGORIES.map((category) => ({
      term: CATEGORY_LABELS[category],
      value: DISPOSITION_LABELS[effective.categories[category].disposition],
    })),
    ...(effective.customAttributes.length > 0
      ? [
          {
            term: "Attribute rules",
            value: effective.customAttributes
              .map(
                (rule) =>
                  `${rule.pattern} ${rule.disposition === "drop" ? "dropped" : "restricted"}`,
              )
              .join(" · "),
          },
        ]
      : []),
    { term: "PII redaction", value: piiValue },
    { term: "Secrets redaction", value: secretsValue },
  ];
  return (
    <VStack gap={3} align="stretch" width="full" paddingTop={2}>
      <VStack gap={0} align="start">
        <Heading as="h3" fontSize="lg">
          Effective for {scopeLabel}
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          What is actually applied, after the rules above cascade down.
        </Text>
      </VStack>
      <Table.Root variant="line" size="sm" width="full">
        <Table.Body>
          {effectiveRows.map(({ term, value }) => (
            <Table.Row key={term}>
              <Table.Cell color="fg.muted">{term}</Table.Cell>
              <Table.Cell textAlign="end">{value}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </VStack>
  );
}
