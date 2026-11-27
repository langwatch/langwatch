/**
 * The Scenario Connector editor: the call, setup and teardown code LangWatch stores and runs,
 * the secrets the blocks may read and the dataset whose rows they receive (ADR-194).
 * @see modules/agent/specs/scenario-connector-agent.feature
 */

import { Drawer } from "@langwatch/design-system/drawer";
import { Text } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";

import {
  useConnectorAgentEditor,
  type AgentConnectorEditorDrawerProps,
} from "../../behavior/use-connector-agent-editor.ts";
import { ConnectorAgentForm } from "../blocks/connector-agent-form.tsx";

export function AgentConnectorEditorDrawer(props: AgentConnectorEditorDrawerProps) {
  const editor = useConnectorAgentEditor(props);

  return (
    <Drawer
      open={editor.isOpen}
      onClose={editor.close}
      onBack={editor.canGoBack ? editor.goBack : void 0}
      backButtonTestId="back-button"
      size="lg"
      title={editor.agentId ? "Edit Scenario Connector" : "New Scenario Connector"}
      body={editor.isEnabled ? "flush" : "padded"}
      bodyScroll={editor.isEnabled ? "content" : "frame"}
      footer={
        editor.isEnabled
          ? {
              cancel: { onClick: editor.close },
              primaryAction: {
                label: editor.agentId ? "Save Changes" : "Create Agent",
                onClick: editor.save,
                loading: editor.isSaving,
                "data-testid": "save-agent-button",
              },
            }
          : void 0
      }
    >
      {!editor.isEnabled && (
        <Text data-testid="connector-agents-disabled-message">
          Scenario Connector agents are not enabled for this project.
        </Text>
      )}
      {editor.isEnabled && editor.isLoading && <SkeletonRows rows={4} />}
      {editor.isEnabled && !editor.isLoading && (
        <ConnectorAgentForm
          form={editor.form}
          errors={editor.errors}
          onChange={editor.change}
          projectId={editor.projectId}
          projectSecretNames={editor.projectSecretNames}
          datasets={editor.datasets}
        />
      )}
    </Drawer>
  );
}
