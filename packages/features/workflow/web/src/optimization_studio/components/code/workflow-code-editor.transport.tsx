import {
  type PythonField,
  WorkflowCodeEditor,
  WorkflowCodeEditorModal,
  type WorkflowCodeEditorContractProps,
  type WorkflowCodeEditorModalHost as WorkflowCodeEditorModalHostPort,
} from "@langwatch/workflow-web";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useMemo } from "react";

import { SecretsIndicator } from "../../../components/secrets/SecretsIndicator";
import { Dialog } from "../../../components/ui/dialog";
import { useOrganizationTeamProject } from "../../../studio-host/use-organization-team-project";
import { api } from "../../../studio-host/api";

type EditorProps = WorkflowCodeEditorContractProps & {
  code: string;
  setCode: (code: string) => void;
  onClose: () => void;
  language: string;
  technologies: string[];
  viewStateKey?: string;
  onEditorMount?: (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
};

type EditorModalProps = WorkflowCodeEditorContractProps & {
  code: string;
  setCode: (code: string) => void;
  open: boolean;
  onClose: () => void;
  viewStateKey?: string;
};

function useEditorTransport() {
  const { project } = useOrganizationTeamProject();
  const secrets = api.secrets.list.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: Boolean(project?.id) },
  );
  const secretNames = useMemo(
    () => (secrets.data ?? []).map((secret: any) => secret.name),
    [secrets.data],
  );

  return { projectId: project?.id, secretNames };
}

/** The app retains its render-error boundary and overlay policy around feature content. */
export const WorkflowCodeEditorModalHost: WorkflowCodeEditorModalHostPort = ({
  open,
  onRequestClose,
  children,
}) => (
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

/** App composition for project-scoped secret transport into the Workflow editor. */
export function CodeEditorModal(props: EditorModalProps) {
  const { projectId, secretNames } = useEditorTransport();

  return (
    <WorkflowCodeEditorModal
      {...props}
      projectId={projectId}
      secretNames={secretNames}
      renderModal={WorkflowCodeEditorModalHost}
      renderSecretControls={({ onInsertSecret }) =>
        projectId ? (
          <SecretsIndicator projectId={projectId} onInsertSecret={onInsertSecret} />
        ) : null
      }
    />
  );
}

/** App composition for project-scoped completion data in the Workflow editor. */
export function CodeEditor({ onEditorMount, ...props }: EditorProps) {
  const { projectId, secretNames } = useEditorTransport();

  return (
    <WorkflowCodeEditor
      {...props}
      projectId={projectId}
      secretNames={secretNames}
      onEditorMount={onEditorMount}
    />
  );
}

export type { PythonField };
