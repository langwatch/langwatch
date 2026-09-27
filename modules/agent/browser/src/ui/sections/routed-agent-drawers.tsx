/**
 * The drawers the address bar opens, each wired to what it reads so it needs no caller
 * (main's #3193; ARCHITECTURE.md: drawers are URL-routed singletons that navigate).
 */
import { CopyButton } from "@langwatch/design-system/copy-button";
import { Button, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/studio-dialog";
import {
  EmojiPickerModal,
  getRandomWorkflowIcon,
  RenderCode,
  WorkflowCodeEditorModal,
  type WorkflowCodeEditorModalHost,
} from "@langwatch/workflow-browser-kit";
import { useState } from "react";

import { useRoutedCodeAgent } from "../../behavior/use-routed-code-agent.ts";
import { useRoutedHttpAgent } from "../../behavior/use-routed-http-agent.ts";
import { useCreateWorkflowAgent } from "../../behavior/use-create-workflow-agent.ts";
import { SetupWithAgentButton } from "../../behavior/lent-setup-with-agent-button.tsx";
import { useConnectedAgentDetail } from "../../behavior/use-connected-agent-detail.ts";
import { useRoutedDrawer } from "../../behavior/use-routed-drawer.ts";
import { ConnectFromCodeDrawer } from "./connect-from-code-drawer.tsx";
import type { AgentBrowser } from "../../model/agent-client.ts";
import { AgentCodeEditorDrawer } from "./agent-code-editor-drawer.tsx";
import { AgentHttpEditorDrawer } from "./agent-http-editor-drawer.tsx";
import { AgentTestPanel } from "./agent-test-panel.tsx";
import { ConnectedAgentDrawer } from "./connected-agent-drawer.tsx";
import { WorkflowSelectorDrawer } from "./workflow-selector-drawer.tsx";

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

export function RoutedWorkflowSelectorDrawer({
  onSave,
}: {
  onSave?: (agent: AgentBrowser) => void;
}) {
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

export function RoutedAgentHttpEditorDrawer({
  agentId,
  onSave,
}: {
  agentId?: string;
  onSave?: (agent: AgentBrowser) => void;
}) {
  const { close, goBack } = useRoutedDrawer();
  const http = useRoutedHttpAgent({ agentId, onSave, close });
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

export function RoutedAgentCodeEditorDrawer({
  agentId,
  onSave,
}: {
  agentId?: string;
  onSave?: (agent: AgentBrowser) => void;
}) {
  const { close, goBack } = useRoutedDrawer();
  const code = useRoutedCodeAgent({ agentId, onSave, close });
  return (
    <AgentCodeEditorDrawer
      {...code.options}
      isLoading={code.isLoading}
      {...(goBack ? { onGoBack: goBack } : {})}
      renderCodeEditor={({ code: source, onExpand }) => (
        <VStack align="stretch" gap={2} data-testid="agent-code-preview">
          <RenderCode code={source} language="python" />
          <Button size="xs" variant="outline" alignSelf="start" onClick={onExpand}>
            Edit code
          </Button>
        </VStack>
      )}
      renderCodeModal={({ code: source, onChange, open, onClose }) => (
        <WorkflowCodeEditorModal
          code={source}
          setCode={onChange}
          open={open}
          onClose={onClose}
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
