import {
  CONTENT_CATEGORIES,
  type DataPrivacySnapshot,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { Card } from "@langwatch/design-system/card";
import { ListTable } from "@langwatch/design-system/list-table";
import { SettingsSection } from "@langwatch/design-system/settings-section";

import {
  CATEGORY_LABELS,
  DISPOSITION_LABELS,
  PII_LABELS,
} from "../../model/data-privacy-labels.ts";
import {
  PII_REDACTION_MODEL_NAME,
  type PiiRedactionModelOffer,
} from "../../model/pii-redaction-level-offer.ts";

/**
 * What is ACTUALLY applied once the rules above cascade down. Declared
 * structurally, not imported from `@langwatch/authz-browser` — this block reads
 * only three fields, narrower than that import's shape.
 */
export type EffectiveScopeSelection =
  | { kind: "all" }
  | { kind: "team-current" }
  | { kind: "project-current" }
  | { kind: "specific"; scopeType: string; scopeId: string; name?: string };

/**
 * The effective view follows the scope filter: org baseline for "All you
 * can see", team baseline for "This team", full cascade for a project.
 * Null team/org baselines (personal account) fall back to project policy.
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

/** With the model offered, Essential and Strict also say what runs them. */
function piiLevelLabel({
  pii,
  piiRedactionModelOffered,
}: {
  pii: ResolvedDataPrivacy["pii"];
  piiRedactionModelOffered: boolean;
}): string {
  if (pii.level === "custom") {
    return `Custom (${pii.entities.length} ${pii.entities.length === 1 ? "type" : "types"})`;
  }
  if (piiRedactionModelOffered && pii.level === "strict") {
    return `Strict · ${PII_REDACTION_MODEL_NAME}`;
  }
  if (piiRedactionModelOffered && pii.level === "essential") {
    return "Essential · standard detection";
  }
  return PII_LABELS[pii.level];
}

export function EffectiveSummary({
  snapshot,
  scopeFilter,
  currentTeamId,
  piiRedactionModelOffer = null,
}: {
  snapshot: DataPrivacySnapshot;
  scopeFilter: EffectiveScopeSelection;
  currentTeamId: string | null;
  /** The Strict offer; null names levels as before. */
  piiRedactionModelOffer?: PiiRedactionModelOffer;
}) {
  const { effective, scopeLabel } = pickEffectiveForScope(snapshot, scopeFilter, currentTeamId);
  const piiValue = piiLevelLabel({
    pii: effective.pii,
    piiRedactionModelOffered: piiRedactionModelOffer !== null,
  });
  const secretsValue = `${effective.secrets.enabled ? "On" : "Off"}${
    effective.secrets.customPatterns.length > 0
      ? ` · ${effective.secrets.customPatterns.length} custom ${
          effective.secrets.customPatterns.length === 1 ? "pattern" : "patterns"
        }`
      : ""
  }`;
  const effectiveRows: { term: string; value: string }[] = [
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
    <SettingsSection
      divided={false}
      title={`Effective for ${scopeLabel}`}
      hint="What is actually applied, after the rules above cascade down."
    >
      <Card padding="none">
        <ListTable variant="embedded" density="compact" aria-label="Effective privacy settings">
          <ListTable.Body>
            {effectiveRows.map(({ term, value }) => (
              <ListTable.Row key={term}>
                <ListTable.Cell tone="muted">{term}</ListTable.Cell>
                <ListTable.Cell align="end">{value}</ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
      </Card>
    </SettingsSection>
  );
}
