import { Button, Heading, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import type {
  DataPrivacyAudienceOptions,
  DataPrivacyConfig,
  DataPrivacyRule,
  DataPrivacyScopeAvailable,
  ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import { useEffect, useMemo, useState, type ReactNode } from "react";

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
  const update = (patch: Partial<RuleFormState>) =>
    setForm((previous) => ({ ...previous, ...patch }));

  // Open transition: seed the drawer. Edit hydrates from the rule, so a field
  // the rule does not set shows as "Inherit" rather than a concrete default. Add
  // starts every control on "Inherit", so a saved-as-is rule changes nothing.
  useEffect(() => {
    if (!open) return;
    setScopes(initialScopes({ editingRule, available, projectId }));
    setForm(editingRule ? configToFormState(editingRule.config) : inheritFormState());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingRule]);

  // The policy a left-on-inherit field resolves to, so each control can show the
  // value it inherits. Keyed off the scope being edited (or the first picked).
  const inheritedBaseline = inheritedBaselineForScope({
    scopeType: editingRule?.scopeType ?? scopes[0]?.scopeType ?? "PROJECT",
    effectiveTeam,
    effectiveOrganization,
  });

  const config = useMemo<DataPrivacyConfig>(() => buildRuleConfig(form), [form]);
  const canSave =
    scopes.length > 0 &&
    ruleHasChange({ config, editingRule }) &&
    !formHasInvalidPatterns(form) &&
    !isSaving;

  return (
    <Drawer.Root
      placement="end"
      size="md"
      open={open}
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">{editingRule ? "Edit privacy rule" : "Add privacy rule"}</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="stretch">
            {editingRule ? (
              <VStack gap={1.5} align="start">
                <Text fontWeight="600" fontSize="sm">
                  Scope
                </Text>
                <RuleScopeLabel rule={editingRule} fontSize="sm" />
              </VStack>
            ) : (
              scopePicker({ value: scopes, onChange: setScopes })
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
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full" justify="end">
            <Button
              colorPalette="blue"
              disabled={!canSave}
              loading={isSaving}
              onClick={() => {
                if (scopes.length === 0) return;
                onSave(scopes, config);
              }}
            >
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
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
