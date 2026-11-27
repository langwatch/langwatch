/**
 * Whether members may connect the docs playground to their own access (ADR-185, amendment of
 * 2026-11-13). Off, the consent page refuses and live docs connections stop working; pasting an
 * API key into the playground still works. Spec: modules/api-key/specs/docs-session-keys.feature
 */
import { HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";

import { PolicySection } from "../elements/policy-section.tsx";

export function DocsPlaygroundCard({
  sessionsEnabled,
  saving,
  onChange,
}: {
  sessionsEnabled: boolean;
  saving: boolean;
  onChange: (sessionsEnabled: boolean) => void;
}) {
  return (
    <PolicySection
      title="Docs playground sessions"
      hint="Members can let the API playground in the docs send requests as them, in one project, for up to an hour."
      actions={
        <HStack
          width="full"
          justify="space-between"
          gap={3}
          borderTopWidth="1px"
          borderColor="border.muted"
          paddingTop={1.5}
        >
          <VStack align="start" gap={0}>
            <Text fontSize="xs">Allow docs playground sessions</Text>
            <Text color="fg.muted" fontSize="xs">
              Turning it off ends the sessions already open.
            </Text>
          </VStack>
          <Switch
            size="sm"
            checked={sessionsEnabled}
            disabled={saving}
            onCheckedChange={(details) => onChange(details.checked)}
            aria-label="Allow docs playground sessions"
            inputProps={{ "data-testid": "docs-playground-switch" }}
          />
        </HStack>
      }
      data-testid="docs-playground-card"
    >
      <Text fontSize="xs" color="fg.muted">
        Members can always paste an API key into the playground instead.
      </Text>
    </PolicySection>
  );
}
