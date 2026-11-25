/**
 * The fit step's fields: the agent under test, its tools, what it must never do, the suite name.
 * @see modules/scenario/specs/suite-template-gallery.feature
 */

import { Field, HStack, Input, Tag, Textarea, VStack } from "@langwatch/design-system/primitives";
import type { SuiteTemplate } from "@langwatch/suite-contract";

import type { SuiteTemplateWizard } from "./use-suite-template-wizard.ts";

function ToolTagsField({
  tools,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  tools: string[];
  draft: string;
  onDraftChange: (draft: string) => void;
  onAdd: () => void;
  onRemove: (tool: string) => void;
}) {
  return (
    <Field.Root>
      <Field.Label>Tools the agent can call</Field.Label>
      {tools.length > 0 && (
        <HStack gap={1} flexWrap="wrap" paddingBottom={1}>
          {tools.map((tool) => (
            <Tag.Root key={tool} size="sm" data-testid={`suite-template-tool-${tool}`}>
              <Tag.Label>{tool}</Tag.Label>
              <Tag.EndElement>
                <Tag.CloseTrigger aria-label={`Remove ${tool}`} onClick={() => onRemove(tool)} />
              </Tag.EndElement>
            </Tag.Root>
          ))}
        </HStack>
      )}
      <Input
        size="sm"
        value={draft}
        placeholder="Type a tool name and press Enter"
        data-testid="suite-template-tool-input"
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            onAdd();
          }
        }}
      />
    </Field.Root>
  );
}

export function SuiteTemplateFitFields({
  template,
  wizard,
}: {
  template: SuiteTemplate;
  wizard: SuiteTemplateWizard;
}) {
  return (
    <VStack align="stretch" gap={4} data-testid="suite-template-fit">
      <Field.Root invalid={!!wizard.agentNameProblem}>
        <Field.Label>Agent name</Field.Label>
        <Input
          size="sm"
          value={wizard.agentName}
          placeholder="e.g. Refunds assistant"
          aria-required
          data-testid="suite-template-agent-name"
          onChange={(event) => wizard.setAgentName(event.target.value)}
        />
        {wizard.agentNameProblem && <Field.ErrorText>{wizard.agentNameProblem}</Field.ErrorText>}
      </Field.Root>
      <ToolTagsField
        tools={wizard.tools}
        draft={wizard.toolDraft}
        onDraftChange={wizard.setToolDraft}
        onAdd={wizard.addTool}
        onRemove={wizard.removeTool}
      />
      <Field.Root>
        <Field.Label>The agent must never</Field.Label>
        <Textarea
          size="sm"
          rows={3}
          value={wizard.mustNever}
          placeholder="One per line, e.g. issue a refund without an order number"
          data-testid="suite-template-must-never"
          onChange={(event) => wizard.setMustNever(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Suite name</Field.Label>
        <Input
          size="sm"
          value={wizard.suiteName}
          placeholder={template.title}
          data-testid="suite-template-suite-name"
          onChange={(event) => wizard.setSuiteName(event.target.value)}
        />
      </Field.Root>
    </VStack>
  );
}
