/**
 * The drawers the address bar opens, each wired to what it reads so it needs no caller
 * (main's #3193; ARCHITECTURE.md: drawers are URL-routed singletons that navigate).
 */
import type { AgentWithFields } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { Link } from "@langwatch/browser-host/link";
import { CodePreview } from "@langwatch/design-system/code-preview";
import { CopyButton } from "@langwatch/design-system/copy-button";
import { Button, VStack } from "@langwatch/design-system/primitives";
import { Dialog } from "@langwatch/design-system/studio-dialog";
import { VariablesSection } from "@langwatch/design-system/variable-mapping";
import { WorkflowCardDisplay } from "@langwatch/design-system/workflow-card";
import { toEpochMs } from "@langwatch/time";
import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { SetupWithAgentButton } from "../../behavior/lent-setup-with-agent-button.tsx";
import { useConnectedAgentDetail } from "../../behavior/use-connected-agent-detail.ts";
import { useCreateWorkflowAgent } from "../../behavior/use-create-workflow-agent.ts";
import { useRoutedAgentList } from "../../behavior/use-routed-agent-list.ts";
import { useRoutedCodeAgent } from "../../behavior/use-routed-code-agent.ts";
import { useRoutedDrawer } from "../../behavior/use-routed-drawer.ts";
import { useRoutedHttpAgent } from "../../behavior/use-routed-http-agent.ts";
import { useRoutedWorkflowAgent } from "../../behavior/use-routed-workflow-agent.ts";
import { useWorkflowTargetMapping } from "../../behavior/use-workflow-target-mapping.ts";
import { getRandomWorkflowIcon } from "../../model/workflow/random-workflow-icon.ts";
import { ScenarioMappingSection } from "../blocks/scenario-mapping-section.tsx";
import {
  WorkflowCodeEditorModal,
  type WorkflowCodeEditorModalHost,
} from "../elements/workflow/code/workflow-code-editor.tsx";
import { AgentCodeEditorDrawer } from "./agent-code-editor-drawer.tsx";
import { AgentHttpEditorDrawer } from "./agent-http-editor-drawer.tsx";
import { AgentListDrawer } from "./agent-list-drawer.tsx";
import { AgentTestPanel } from "./agent-test-panel.tsx";
import { AgentWorkflowEditorDrawer } from "./agent-workflow-editor-drawer.tsx";
import { AgentWorkflowTargetEditorDrawer } from "./agent-workflow-target-editor-drawer.tsx";
import { ConnectFromCodeDrawer } from "./connect-from-code-drawer.tsx";
import { ConnectedAgentDrawer } from "./connected-agent-drawer.tsx";
import { WorkflowSelectorDrawer } from "./workflow-selector-drawer.tsx";
import { EmojiPickerModal } from "./workflow/optimization_studio/properties/modals/emoji-picker-modal.tsx";

/** What a caller hands agent's HTTP or code editor: the agent to edit, and where a save goes. */
export type AgentEditorDrawerProps = {
  agentId?: string;
  onSave?: (agent: WireOf<AgentWithFields>) => void;
};

/** What a caller hands agent's workflow selector drawer: where the agent it creates goes. */
export type WorkflowSelectorDrawerProps = {
  onSave?: (agent: WireOf<AgentWithFields>) => void;
};

/** Flow callbacks (`onSelect`, `onCreateNew`) arrive as props, merged by the drawer host. */
export function RoutedAgentListDrawer({
  onSelect,
  onCreateNew,
}: {
  onSelect?: (agent: WireOf<AgentWithFields>) => void;
  onCreateNew?: () => void;
}) {
  const { close } = useRoutedDrawer();
  const { openDrawer } = useDrawer();
  const list = useRoutedAgentList();
  return (
    <AgentListDrawer
      open
      items={list.items}
      isLoading={list.isLoading}
      {...(list.errorMessage ? { errorMessage: list.errorMessage } : {})}
      onClose={close}
      onSelect={(agent) => {
        onSelect?.(agent);
        close();
      }}
      onEdit={list.edit}
      onCreateNew={onCreateNew ?? (() => openDrawer("agentTypeSelector"))}
      {...list.archive}
    />
  );
}

export function RoutedConnectedAgentDrawer({ agentId }: { agentId?: string }) {
  const { close } = useRoutedDrawer();
  const detail = useConnectedAgentDetail(agentId);
  return (
    <ConnectedAgentDrawer
      agent={detail.agent ?? null}
      isLoading={detail.isLoading}
      projectId={detail.projectId}
      onClose={close}
    />
  );
}

export function RoutedConnectFromCodeDrawer() {
  const { close, goBack } = useRoutedDrawer();
  return (
    <ConnectFromCodeDrawer
      open
      onClose={close}
      {...(goBack ? { onGoBack: goBack } : {})}
      setupButton={<SetupWithAgentButton surface="connectedAgents" />}
      renderCopyButton={({ value, label }) => (
        <CopyButton value={value} label={label} aria-label={`Copy ${label.toLowerCase()}`} />
      )}
    />
  );
}

export function RoutedWorkflowSelectorDrawer({ onSave }: WorkflowSelectorDrawerProps) {
  const { close, goBack } = useRoutedDrawer();
  const [defaultIcon] = useState(getRandomWorkflowIcon);
  const workflowAgent = useCreateWorkflowAgent({ onSave });
  return (
    <WorkflowSelectorDrawer
      open
      defaultIcon={defaultIcon}
      isSaving={workflowAgent.isSaving}
      onClose={close}
      {...(goBack ? { onGoBack: goBack } : {})}
      onCreate={workflowAgent.create}
      renderIconPicker={(picker) => <EmojiPickerModal {...picker} />}
    />
  );
}

export function RoutedAgentHttpEditorDrawer({ agentId, onSave }: AgentEditorDrawerProps) {
  const { close, goBack } = useRoutedDrawer();
  const http = useRoutedHttpAgent({ agentId, onSave, close, ...(goBack ? { goBack } : {}) });
  return (
    <AgentHttpEditorDrawer
      {...http.options}
      {...(goBack ? { onGoBack: goBack } : {})}
      renderScenarioMappings={(section) => <ScenarioMappingSection {...section} />}
      renderVariables={() => null}
      renderTestPanel={(panel) => <AgentTestPanel {...panel} />}
      explainTestError={http.explainTestError}
    />
  );
}

const CodeEditorModalHost: WorkflowCodeEditorModalHost = ({ open, onRequestClose, children }) => (
  <Dialog.Root
    open={open}
    onOpenChange={({ open: nextOpen }) => !nextOpen && onRequestClose()}
    closeOnEscape={false}
  >
    <Dialog.Content
      margin="32px"
      minWidth="calc(100vw - 64px)"
      height="calc(100vh - 64px)"
      display="flex"
      flexDirection="column"
      overflow="hidden"
      positionerProps={{ zIndex: 1502 }}
    >
      {children}
    </Dialog.Content>
  </Dialog.Root>
);

export function RoutedAgentCodeEditorDrawer({ agentId, onSave }: AgentEditorDrawerProps) {
  const { close, goBack } = useRoutedDrawer();
  const code = useRoutedCodeAgent({ agentId, onSave, close });
  return (
    <AgentCodeEditorDrawer
      {...code.options}
      isLoading={code.isLoading}
      {...(goBack ? { onGoBack: goBack } : {})}
      renderCodeEditor={(editor) => (
        <VStack align="stretch" gap={2} data-testid="agent-code-preview">
          <CodePreview
            code={editor.code}
            language="python"
            filename="code.py"
            lineNumbers
            compact
          />
          <Button size="xs" variant="outline" alignSelf="start" onClick={() => editor.onExpand()}>
            Edit code
          </Button>
        </VStack>
      )}
      renderCodeModal={(modal) => (
        <WorkflowCodeEditorModal
          code={modal.code}
          setCode={(source) => modal.onChange(source)}
          open={modal.open}
          onClose={() => modal.onClose()}
          secretNames={[]}
          renderModal={CodeEditorModalHost}
          {...(code.options.projectId ? { projectId: code.options.projectId } : {})}
        />
      )}
      renderInputs={() => null}
      renderOutputs={() => null}
      renderMappings={() => null}
      renderTestPanel={(panel) => <AgentTestPanel {...panel} />}
    />
  );
}

// ponytail: the workflow editor drawer still draws no mapping editor (saved mappings keep their
// defaults); the target drawer below renders the design-system mapping section.
export function RoutedAgentWorkflowEditorDrawer({ agentId, onSave }: AgentEditorDrawerProps) {
  const { close, goBack } = useRoutedDrawer();
  const workflow = useRoutedWorkflowAgent({ agentId, close, ...(onSave ? { onSave } : {}) });
  return (
    <AgentWorkflowEditorDrawer
      {...workflow.options}
      {...(goBack ? { onGoBack: goBack } : {})}
      renderMappings={() => null}
    />
  );
}

export function RoutedAgentWorkflowTargetEditorDrawer({ agentId }: { agentId?: string }) {
  const { close, goBack } = useRoutedDrawer();
  const workflow = useRoutedWorkflowAgent({ agentId, close });
  const mapping = useWorkflowTargetMapping();
  const linked = workflow.workflow;
  const card = linked && (
    <WorkflowCardDisplay
      name={linked.name}
      icon={linked.icon}
      updatedAtLabel={formatTimeAgo(toEpochMs(linked.updatedAt))}
      width="300px"
      {...(workflow.editorHref ? { action: <ExternalLink size={16} /> } : {})}
    />
  );
  return (
    <AgentWorkflowTargetEditorDrawer
      open
      isLoading={workflow.options.isLoading}
      hasLookupFailed={workflow.hasLookupFailed}
      workflowCard={
        workflow.editorHref ? (
          <Link href={workflow.editorHref} isExternal data-testid="open-workflow-link">
            {card}
          </Link>
        ) : (
          card
        )
      }
      mappings={
        <VariablesSection
          title="Input Variables"
          variables={workflow.targetInputs}
          onChange={() => undefined}
          showMappings
          availableSources={mapping.availableSources}
          mappings={mapping.inputMappings}
          {...(mapping.onInputMappingsChange
            ? { onMappingChange: mapping.onInputMappingsChange }
            : {})}
          canAddRemove={false}
          readOnly={false}
        />
      }
      onClose={close}
      {...(goBack ? { onGoBack: goBack } : {})}
    />
  );
}
