/**
 * The template gallery: pick an archetype or a red team pack, read every scenario it holds, say
 * how it fits the agent under test, then create the suite in one step.
 * @see modules/scenario/specs/suite-template-gallery.feature
 */

import { Card, CardGrid } from "@langwatch/design-system/card";
import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { Dialog } from "@langwatch/design-system/dialog";
import {
  Badge,
  EmptyState,
  Field,
  HStack,
  Input,
  Skeleton,
  Tag,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import type { SuiteTemplate, SuiteTemplateFit, SuiteTemplateKind } from "@langwatch/suite-contract";
import { useEffect, useState } from "react";

import { owaspCategoryLabel } from "../../../../model/owasp-category.ts";

export type SuiteTemplateCreateRequest = {
  templateId: string;
  fit: SuiteTemplateFit;
  name?: string;
};

export type SuiteTemplateGalleryDialogProps = {
  open: boolean;
  onClose: () => void;
  templates: SuiteTemplate[] | undefined;
  isLoading: boolean;
  loadFailed: boolean;
  onRetry: () => void;
  isCreating: boolean;
  onCreate: (request: SuiteTemplateCreateRequest) => void;
};

export const AGENT_NAME_REQUIRED = "Name the agent under test.";
export const TEMPLATES_LOAD_FAILED = "Couldn't load the templates";

const TAB_LABELS: Record<SuiteTemplateKind, string> = {
  archetype: "Archetypes",
  red_team_pack: "Red team",
};

type Step = "browse" | "preview" | "fit";

function scenarioCount(template: SuiteTemplate): string {
  const count = template.scenarios.length;
  return count === 1 ? "1 scenario" : `${count} scenarios`;
}

function TemplateCards({
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
          description={template.description}
          badge={<Badge size="sm">{scenarioCount(template)}</Badge>}
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

function TemplatePreview({ template }: { template: SuiteTemplate }) {
  return (
    <VStack align="stretch" gap={3} data-testid="suite-template-preview">
      <Text textStyle="sm" color="fg.muted">
        {template.description}
      </Text>
      {template.scenarios.map((scenario) => (
        <Card
          key={scenario.key}
          variant="nested"
          padding="sm"
          title={scenario.name}
          description={scenario.attack?.attackGoal ?? scenario.situation}
          badge={
            scenario.attack ? (
              <HStack gap={1}>
                {scenario.attack.owaspIds.map((owaspId) => (
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

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

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

export function SuiteTemplateGalleryDialog(props: SuiteTemplateGalleryDialogProps) {
  const [tab, setTab] = useState<SuiteTemplateKind>("archetype");
  const [step, setStep] = useState<Step>("browse");
  const [chosen, setChosen] = useState<SuiteTemplate | null>(null);
  const [agentName, setAgentName] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [toolDraft, setToolDraft] = useState("");
  const [mustNever, setMustNever] = useState("");
  const [suiteName, setSuiteName] = useState("");
  const [agentNameProblem, setAgentNameProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setStep("browse");
    setChosen(null);
    setAgentName("");
    setTools([]);
    setToolDraft("");
    setMustNever("");
    setSuiteName("");
    setAgentNameProblem(null);
  }, [props.open]);

  const addTool = () => {
    const tool = toolDraft.trim().replace(/,$/, "").trim();
    if (tool && !tools.includes(tool)) setTools([...tools, tool]);
    setToolDraft("");
  };

  const submit = () => {
    if (!chosen || props.isCreating) return;
    const name = agentName.trim();
    if (!name) {
      setAgentNameProblem(AGENT_NAME_REQUIRED);
      return;
    }
    setAgentNameProblem(null);
    const pendingTool = toolDraft.trim();
    const allTools = pendingTool && !tools.includes(pendingTool) ? [...tools, pendingTool] : tools;
    props.onCreate({
      templateId: chosen.id,
      fit: { agentName: name, tools: allTools, mustNever: splitLines(mustNever) },
      ...(suiteName.trim() ? { name: suiteName.trim() } : {}),
    });
  };

  const loadError = props.loadFailed
    ? { title: TEMPLATES_LOAD_FAILED, onRetry: props.onRetry }
    : undefined;

  if (step === "preview" && chosen) {
    return (
      <Dialog
        open={props.open}
        onClose={props.onClose}
        title={chosen.title}
        size="lg"
        secondaryAction={{ label: "Back", onClick: () => setStep("browse") }}
        primaryAction={{
          label: "Next",
          onClick: () => setStep("fit"),
          "data-testid": "suite-template-next",
        }}
        data-testid="suite-template-gallery"
      >
        <TemplatePreview template={chosen} />
      </Dialog>
    );
  }

  if (step === "fit" && chosen) {
    return (
      <Dialog
        open={props.open}
        onClose={props.onClose}
        title={`Fit ${chosen.title} to your agent`}
        size="md"
        busy={props.isCreating}
        onSubmit={submit}
        secondaryAction={{ label: "Back", onClick: () => setStep("preview") }}
        primaryAction={{
          label: "Create suite",
          type: "submit",
          loading: props.isCreating,
          "data-testid": "suite-template-create",
        }}
        data-testid="suite-template-gallery"
      >
        <VStack align="stretch" gap={4} data-testid="suite-template-fit">
          <Field.Root invalid={!!agentNameProblem}>
            <Field.Label>Agent name</Field.Label>
            <Input
              size="sm"
              value={agentName}
              placeholder="e.g. Refunds assistant"
              data-testid="suite-template-agent-name"
              onChange={(event) => setAgentName(event.target.value)}
            />
            {agentNameProblem && <Field.ErrorText>{agentNameProblem}</Field.ErrorText>}
          </Field.Root>
          <ToolTagsField
            tools={tools}
            draft={toolDraft}
            onDraftChange={setToolDraft}
            onAdd={addTool}
            onRemove={(tool) => setTools(tools.filter((other) => other !== tool))}
          />
          <Field.Root>
            <Field.Label>The agent must never</Field.Label>
            <Textarea
              size="sm"
              rows={3}
              value={mustNever}
              placeholder="One per line, e.g. issue a refund without an order number"
              data-testid="suite-template-must-never"
              onChange={(event) => setMustNever(event.target.value)}
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Suite name</Field.Label>
            <Input
              size="sm"
              value={suiteName}
              placeholder={chosen.title}
              data-testid="suite-template-suite-name"
              onChange={(event) => setSuiteName(event.target.value)}
            />
          </Field.Root>
        </VStack>
      </Dialog>
    );
  }

  const tabItems = (["archetype", "red_team_pack"] as const).map((kind) => ({
    value: kind,
    label: TAB_LABELS[kind],
    testId: `suite-template-tab-${kind}`,
    content: (
      <TemplateCards
        templates={props.templates ?? []}
        kind={kind}
        onChoose={(template) => {
          setChosen(template);
          setStep("preview");
        }}
      />
    ),
  }));

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="New suite from a template"
      size="lg"
      error={loadError}
      cancelLabel="Cancel"
      data-testid="suite-template-gallery"
    >
      {props.isLoading ? (
        <VStack align="stretch" gap={2} data-testid="suite-template-loading">
          <Skeleton height="72px" />
          <Skeleton height="72px" />
        </VStack>
      ) : (
        <ContentTabs
          label="Template kind"
          density="compact"
          value={tab}
          onValueChange={({ value }) => setTab(value)}
          items={tabItems}
        />
      )}
    </Dialog>
  );
}
