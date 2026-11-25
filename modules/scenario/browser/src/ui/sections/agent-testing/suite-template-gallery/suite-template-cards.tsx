/**
 * The gallery's presentation: a tab of template cards and the preview of every scenario a
 * template holds. Copy reads generically until the fit step names the agent.
 * @see modules/scenario/specs/suite-template-gallery.feature
 */

import { Card, CardGrid } from "@langwatch/design-system/card";
import { Badge, EmptyState, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { SuiteTemplate, SuiteTemplateKind } from "@langwatch/suite-contract";

import { owaspCategoryLabel, owaspLabelRepeatsName } from "../../../../model/owasp-category.ts";
import { SuiteTemplateIcon } from "./suite-template-icon.tsx";

export const TAB_LABELS: Record<SuiteTemplateKind, string> = {
  archetype: "Archetypes",
  red_team_pack: "Red team",
};

/**
 * Template copy names {{agentName}} and {{tools}}; before the fit step they read generically.
 * Only the exact spelling the server fills counts as a placeholder, so preview and result agree.
 */
export function withAgentPlaceholder(text: string): string {
  return text
    .replace(/\{\{agentName\}\}/g, "your agent")
    .replace(/\s*\(\{\{tools\}\}\)/g, "")
    .replace(/\{\{tools\}\}/g, "its tools");
}

function scenarioCount(template: SuiteTemplate): string {
  const count = template.scenarios.length;
  return count === 1 ? "1 scenario" : `${count} scenarios`;
}

export function TemplateCards({
  templates,
  kind,
  onChoose,
}: {
  templates: SuiteTemplate[];
  kind: SuiteTemplateKind;
  onChoose: (template: SuiteTemplate) => void;
}) {
  const ofKind = templates.filter((template) => template.kind === kind);
  if (ofKind.length === 0) {
    return (
      <EmptyState.Root size="sm" data-testid={`suite-template-empty-${kind}`}>
        <EmptyState.Content>
          <EmptyState.Title>No {TAB_LABELS[kind].toLowerCase()} templates yet</EmptyState.Title>
        </EmptyState.Content>
      </EmptyState.Root>
    );
  }
  return (
    <CardGrid columns={2}>
      {ofKind.map((template) => (
        <Card
          key={template.id}
          title={template.title}
          icon={<SuiteTemplateIcon template={template} />}
          description={withAgentPlaceholder(template.description)}
          badge={
            <Badge size="sm" colorPalette="blue" flexShrink={0} whiteSpace="nowrap">
              {scenarioCount(template)}
            </Badge>
          }
          opener={
            <button
              type="button"
              aria-label={template.title}
              data-testid={`suite-template-card-${template.id}`}
              onClick={() => onChoose(template)}
            />
          }
        />
      ))}
    </CardGrid>
  );
}

export function TemplatePreview({ template }: { template: SuiteTemplate }) {
  return (
    <VStack align="stretch" gap={3} data-testid="suite-template-preview">
      <Text textStyle="sm" color="fg.muted">
        {withAgentPlaceholder(template.description)}
      </Text>
      {template.scenarios.map((scenario) => (
        <Card
          key={scenario.key}
          variant="nested"
          padding="sm"
          title={scenario.name}
          description={withAgentPlaceholder(scenario.attack?.attackGoal ?? scenario.situation)}
          badge={
            scenario.attack ? (
              <HStack gap={1}>
                {scenario.attack.owaspIds
                  .filter((owaspId) => !owaspLabelRepeatsName({ id: owaspId, name: scenario.name }))
                  .map((owaspId) => (
                    <Badge key={owaspId} size="sm" colorPalette="red">
                      {owaspCategoryLabel({ id: owaspId })}
                    </Badge>
                  ))}
              </HStack>
            ) : undefined
          }
          data-testid={`suite-template-preview-${scenario.key}`}
        />
      ))}
    </VStack>
  );
}
