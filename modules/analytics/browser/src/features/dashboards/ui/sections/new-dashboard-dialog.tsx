/**
 * The library's "New dashboard": a name and who can see it, then the board is made and opened.
 * Mounted by its opener while open, so each opening starts from fresh defaults.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { DashboardScope } from "@langwatch/dashboard-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import { Field, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { useState } from "react";

import { firstUntitledName } from "../../model/organization-library.ts";

/** One choice of who can see the new board. */
type SharingChoice = { scope: DashboardScope; title: string; hint: string };

function sharingChoices({
  projectName,
  organizationName,
}: {
  projectName: string;
  organizationName: string;
}): SharingChoice[] {
  return [
    { scope: "PROJECT", title: "Project", hint: `Everyone in ${projectName}` },
    { scope: "ORGANIZATION", title: "Organization", hint: `Everyone in ${organizationName}` },
    { scope: "PRIVATE", title: "Only me", hint: "You can share it later" },
  ];
}

function NameField({
  name,
  onName,
  isMissing,
}: {
  name: string;
  onName: (name: string) => void;
  isMissing: boolean;
}) {
  return (
    <Field.Root invalid={isMissing}>
      <Field.Label>Name</Field.Label>
      <Input
        autoFocus
        value={name}
        onChange={(event) => onName(event.target.value)}
        onFocus={(event) => event.target.select()}
      />
      <Field.ErrorText>Give the dashboard a name.</Field.ErrorText>
    </Field.Root>
  );
}

/** Who can see the new board: its project, the whole organization, or only its maker. */
function SharingFieldset({
  scope,
  onScope,
  projectName,
  organizationName,
}: {
  scope: DashboardScope;
  onScope: (scope: DashboardScope) => void;
  projectName: string;
  organizationName: string;
}) {
  const choices = sharingChoices({ projectName, organizationName });
  return (
    <VStack as="fieldset" align="stretch" gap={1.5}>
      <Text as="legend" textStyle="caption" fontWeight="medium" color="fg.muted">
        Who can see it
      </Text>
      <RadioGroup
        value={scope}
        onValueChange={(details: { value: string | null }) => {
          const picked = choices.find((choice) => choice.scope === details.value);
          if (picked) onScope(picked.scope);
        }}
      >
        <VStack align="stretch" gap={2}>
          {choices.map((choice) => (
            <Radio key={choice.scope} value={choice.scope}>
              <VStack align="start" gap={0}>
                <Text textStyle="bodySm" fontWeight="medium">
                  {choice.title}
                </Text>
                <Text textStyle="caption" color="fg.muted">
                  {choice.hint}
                </Text>
              </VStack>
            </Radio>
          ))}
        </VStack>
      </RadioGroup>
    </VStack>
  );
}

export function NewDashboardDialog({
  takenNames,
  projectName,
  organizationName,
  isCreating,
  onCreate,
  onClose,
}: {
  /** The names boards in the project it is stored in already have. */
  takenNames: readonly string[];
  projectName: string;
  organizationName: string;
  isCreating: boolean;
  /** Makes the board; true once it is made, which closes the dialog. */
  onCreate: (input: { name: string; scope: DashboardScope }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(() => firstUntitledName(takenNames));
  const [scope, setScope] = useState<DashboardScope>("PROJECT");
  const [attempted, setAttempted] = useState(false);

  const submit = async () => {
    if (isCreating) return;
    if (!name.trim()) {
      setAttempted(true);
      return;
    }
    if (await onCreate({ name: name.trim(), scope })) onClose();
  };

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title="New dashboard"
      busy={isCreating}
      onSubmit={() => void submit()}
      primaryAction={{ label: "Create", type: "submit", loading: isCreating }}
    >
      <VStack align="stretch" gap={4}>
        <NameField name={name} onName={setName} isMissing={attempted && !name.trim()} />
        <SharingFieldset
          scope={scope}
          onScope={setScope}
          projectName={projectName}
          organizationName={organizationName}
        />
        <Text textStyle="caption" color="fg.subtle">
          Lives in LLM Ops, stored in {projectName}.
        </Text>
      </VStack>
    </Dialog>
  );
}
