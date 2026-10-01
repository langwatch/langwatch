/**
 * The drawers the address bar opens, each wired to what it reads so it needs no caller
 * (main's #3193; ARCHITECTURE.md: drawers are URL-routed singletons that navigate).
 */
import type {
  UiAgentEditorDrawerProps,
  UiWorkflowSelectorDrawerProps,
} from "@langwatch/browser-host/drawer";
import { CopyButton } from "@langwatch/design-system/copy-button";
import { Button, VStack } from "@langwatch/design-system/primitives";
import { Dialog } from "@langwatch/design-system/studio-dialog";
import { useState } from "react";

import { SetupWithAgentButton } from "../../behavior/lent-setup-with-agent-button.tsx";
import { useConnectedAgentDetail } from "../../behavior/use-connected-agent-detail.ts";
import { useCreateWorkflowAgent } from "../../behavior/use-create-workflow-agent.ts";
import { useRoutedCodeAgent } from "../../behavior/use-routed-code-agent.ts";
import { useRoutedDrawer } from "../../behavior/use-routed-drawer.ts";
import { useRoutedHttpAgent } from "../../behavior/use-routed-http-agent.ts";
import { useRoutedWorkflowAgent } from "../../behavior/use-routed-workflow-agent.ts";
import { getRandomWorkflowIcon } from "../../model/workflow/random-workflow-icon.ts";
import {
  WorkflowCodeEditorModal,
  type WorkflowCodeEditorModalHost,
} from "../elements/workflow/code/workflow-code-editor.tsx";
import { AgentCodeEditorDrawer } from "./agent-code-editor-drawer.tsx";
import { AgentHttpEditorDrawer } from "./agent-http-editor-drawer.tsx";
import { AgentTestPanel } from "./agent-test-panel.tsx";
import { AgentWorkflowEditorDrawer } from "./agent-workflow-editor-drawer.tsx";
import { AgentWorkflowTargetEditorDrawer } from "./agent-workflow-target-editor-drawer.tsx";
import { ConnectFromCodeDrawer } from "./connect-from-code-drawer.tsx";
import { ConnectedAgentDrawer } from "./connected-agent-drawer.tsx";
import { WorkflowSelectorDrawer } from "./workflow-selector-drawer.tsx";
import { RenderCode } from "./workflow/code/render-code.tsx";
import { EmojiPickerModal } from "./workflow/optimization_studio/properties/modals/emoji-picker-modal.tsx";

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

export function RoutedWorkflowSelectorDrawer({ onSave }: UiWorkflowSelectorDrawerProps) {
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

export function RoutedAgentHttpEditorDrawer({ agentId, onSave }: UiAgentEditorDrawerProps) {
  const { close, goBack } = useRoutedDrawer();
  const http = useRoutedHttpAgent({ agentId, onSave, close, ...(goBack ? { goBack } : {}) });
  return (
    <AgentHttpEditorDrawer
      {...http.options}
      {...(goBack ? { onGoBack: goBack } : {})}
      renderScenarioMappings={() => null}
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
      bg="bg"
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

export function RoutedAgentCodeEditorDrawer({ agentId, onSave }: UiAgentEditorDrawerProps) {
  const { close, goBack } = useRoutedDrawer();
  const code = useRoutedCodeAgent({ agentId, onSave, close });
  return (
    <AgentCodeEditorDrawer
      {...code.options}
      isLoading={code.isLoading}
      {...(goBack ? { onGoBack: goBack } : {})}
      renderCodeEditor={(editor) => (
        <VStack align="stretch" gap={2} data-testid="agent-code-preview">
          <RenderCode code={editor.code} language="python" />
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

// ponytail: mapping sections and the workflow card live in other modules' browsers; until one is
// lent as a capability these drawers draw no mapping editor (saved mappings keep their defaults).
export function RoutedAgentWorkflowEditorDrawer({ agentId, onSave }: UiAgentEditorDrawerProps) {
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
  return (
    <AgentWorkflowTargetEditorDrawer
      open
      isLoading={workflow.options.isLoading}
      hasLookupFailed={workflow.hasLookupFailed}
      mappings={null}
      onClose={close}
      {...(goBack ? { onGoBack: goBack } : {})}
    />
  );
}
