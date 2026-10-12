import type {
  DataPrivacyAudienceOptions,
  DataPrivacyConfig,
  DataPrivacyRule,
  DataPrivacyScopeAvailable,
  ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import { Alert, Box, Separator, Text, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { describeAudienceSelection } from "../../model/data-privacy-labels.ts";
import {
  buildRuleConfig,
  configToFormState,
  inheritedBaselineForScope,
  inheritFormState,
  type RuleFormState,
} from "../../model/data-privacy-rule-config.ts";
import {
  formHasInvalidPatterns,
  formRestrictsContent,
  ruleHasChange,
} from "../../model/data-privacy-rule-form.ts";
import { AudiencePicker } from "../elements/audience-picker.tsx";
import { RuleScopeLabel } from "../elements/rule-scope-label.tsx";
import { ContentDispositionFields } from "./content-disposition-fields.tsx";
import { CustomAttributeRules } from "./custom-attribute-rules.tsx";
import { PiiRedactionFields } from "./pii-redaction-fields.tsx";
import { SecretsRedactionFields } from "./secrets-redaction-fields.tsx";

/**
 * Writes privacy rules; uses scopePicker render prop because scope selection
 * reads organization data this feature doesn't own.
 */

/** One scope the rule is written at. Structural, so the picker stays the caller's. */
export type PrivacyScopeEntry = {
  scopeType: "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "PROJECT";
  scopeId: string;
  personalOnly?: boolean;
};

export function PrivacyRuleDrawer({
  open,
  editingRule,
  onClose,
  available,
  audienceOptions,
  effectiveTeam,
  effectiveOrganization,
  projectId,
  isSaving,
  onSave,
  scopePicker,
}: {
  open: boolean;
  editingRule: DataPrivacyRule | null;
  onClose: () => void;
  available: DataPrivacyScopeAvailable;
  audienceOptions: DataPrivacyAudienceOptions;
  effectiveTeam: ResolvedDataPrivacy | null;
  effectiveOrganization: ResolvedDataPrivacy | null;
  projectId: string;
  isSaving: boolean;
  onSave: (scopes: PrivacyScopeEntry[], config: DataPrivacyConfig) => void;
  /** Renders the scope picker in add mode, wired to `value` and `onChange`. */
  scopePicker: (props: {
    value: PrivacyScopeEntry[];
    onChange: (value: PrivacyScopeEntry[]) => void;
  }) => ReactNode;
}) {
  const [scopes, setScopes] = useState<PrivacyScopeEntry[]>([]);
  const [form, setForm] = useState<RuleFormState>(inheritFormState);
  const [attempts, setAttempts] = useState(0);
  const update = (patch: Partial<RuleFormState>) =>
    setForm((previous) => ({ ...previous, ...patch }));

  // Open transition: seed the drawer. Edit hydrates from the rule, so a field
  // the rule does not set shows as "Inherit" rather than a concrete default. Add
  // starts every control on "Inherit", so a saved-as-is rule changes nothing.
  useEffect(() => {
    if (!open) return;
    setScopes(initialScopes({ editingRule, available, projectId }));
    setForm(editingRule ? configToFormState(editingRule.config) : inheritFormState());
    setAttempts(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingRule]);

  // The policy a left-on-inherit field resolves to, so each control can show the
  // value it inherits. Keyed off the scope being edited (or the first picked).
  const inheritedBaseline = inheritedBaselineForScope({
    scopeType: editingRule?.scopeType ?? scopes[0]?.scopeType ?? "PROJECT",
    effectiveTeam,
    effectiveOrganization,
  });

  const config: DataPrivacyConfig = buildRuleConfig(form);
  const noScope = scopes.length === 0;
  const unchanged = !ruleHasChange({ config, editingRule });
  const badPatterns = formHasInvalidPatterns(form);

  // Save stays clickable; an attempt with a problem shows it and moves focus there.
  const scopeRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const focusScope = useRef(false);
  const unchangedMessage = editingRule
    ? "This rule has no changes to save."
    : "Choose at least one setting other than Inherit.";
  const summary = [
    unchanged ? unchangedMessage : null,
    badPatterns ? "Fix the patterns marked in red." : null,
  ].filter((message) => message !== null);

  useEffect(() => {
    if (attempts === 0) return;
    (focusScope.current ? scopeRef : summaryRef).current?.focus();
  }, [attempts]);

  const trySave = () => {
    if (isSaving) return;
    if (noScope || unchanged || badPatterns) {
      focusScope.current = noScope;
      setAttempts((count) => count + 1);
      return;
    }
    onSave(scopes, config);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editingRule ? "Edit privacy rule" : "Add privacy rule"}
      size="md"
      footer={{ primaryAction: { label: "Save", onClick: trySave, loading: isSaving } }}
    >
      <VStack gap={5} align="stretch">
        {attempts > 0 && summary.length > 0 && (
          <Alert.Root status="error" role="alert" ref={summaryRef} tabIndex={-1}>
            <Alert.Indicator />
            <Alert.Content>
              {summary.map((message) => (
                <Alert.Description key={message}>{message}</Alert.Description>
              ))}
            </Alert.Content>
          </Alert.Root>
        )}
        {editingRule ? (
          <VStack gap={1.5} align="start">
            <Text fontWeight="600" fontSize="sm">
              Scope
            </Text>
            <RuleScopeLabel rule={editingRule} fontSize="sm" />
          </VStack>
        ) : (
          <Box ref={scopeRef} tabIndex={-1} outline="none">
            {scopePicker({ value: scopes, onChange: setScopes })}
            {attempts > 0 && noScope && (
              <Text role="alert" fontSize="xs" color="fg.error" marginTop={1.5}>
                Pick at least one scope to save this rule at.
              </Text>
            )}
          </Box>
        )}

        <ContentDispositionFields
          dispositions={form.dispositions}
          inheritedBaseline={inheritedBaseline}
          onChange={(dispositions) => update({ dispositions })}
        />

        <CustomAttributeRules
          rows={form.customAttributes}
          onChange={(customAttributes) => update({ customAttributes })}
        />

        {formRestrictsContent(form) && (
          <VStack gap={2} align="stretch">
            <Text fontWeight="600" fontSize="sm">
              Restricted content is visible to
            </Text>
            <AudiencePicker
              audience={form.audience}
              options={audienceOptions}
              onChange={(audience) => update({ audience })}
            />
            <Text fontSize="xs" color="fg.muted">
              {describeAudienceSelection(form.audience, audienceOptions)}
            </Text>
          </VStack>
        )}

        <Separator />

        <PiiRedactionFields
          form={form}
          inheritedLevel={inheritedBaseline.pii.level}
          onChange={update}
        />

        <SecretsRedactionFields
          form={form}
          inheritedEnabled={inheritedBaseline.secrets.enabled}
          onChange={update}
        />
      </VStack>
    </Drawer>
  );
}

/** Edit writes back at the rule's own scope; add starts at the current project when it may. */
function initialScopes({
  editingRule,
  available,
  projectId,
}: {
  editingRule: DataPrivacyRule | null;
  available: DataPrivacyScopeAvailable;
  projectId: string;
}): PrivacyScopeEntry[] {
  if (editingRule) {
    return [
      {
        scopeType: editingRule.scopeType,
        scopeId: editingRule.scopeId,
        ...(editingRule.personalOnly ? { personalOnly: true } : {}),
      },
    ];
  }
  return available.projects.some((project) => project.id === projectId)
    ? [{ scopeType: "PROJECT", scopeId: projectId }]
    : [];
}
