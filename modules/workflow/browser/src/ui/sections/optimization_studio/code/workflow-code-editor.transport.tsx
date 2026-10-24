import { Dialog } from "@langwatch/design-system/dialog";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useMemo } from "react";

import { useOrganizationTeamProject } from "../../../../behavior/studio-host/use-organization-team-project.ts";
import { useCodeEditorLangy } from "../../../../behavior/use-code-editor-langy.ts";
import { workflowApi } from "../../../../behavior/workflow-api.ts";
import { codeLanguageFrom } from "../../../../model/code-language.ts";
import {
  type CodeBlockLangySubject,
  codeBlockSecretNames,
} from "../../../../model/code/code-block-langy.ts";
import { type PythonField } from "../../../../model/code/python-provider.shared.ts";
import {
  WorkflowCodeEditor,
  WorkflowCodeEditorModal,
  type WorkflowCodeEditorContractProps,
  type WorkflowCodeEditorModalHost as WorkflowCodeEditorModalHostApi,
} from "../../../elements/code/workflow-code-editor.tsx";
import { SecretsIndicator } from "../../secrets/secrets-indicator.tsx";

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
  language?: string;
  viewStateKey?: string;
  /** The code node this editor is open on, which is what Langy may be asked about. */
  langySubject?: CodeBlockLangySubject;
};

function useEditorTransport() {
  const { project } = useOrganizationTeamProject();
  const secrets = workflowApi.secrets.list.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: Boolean(project?.id) },
  );
  const secretNames = useMemo(() => codeBlockSecretNames(secrets.data ?? []), [secrets.data]);

  return { projectId: project?.id, secretNames };
}

/** Over Studio's node drawer (1500), under Langy's panel held above it (1600). */
const BETWEEN_DRAWER_AND_LANGY = 1501;

/**
 * The app retains its render-error boundary and overlay policy around feature content. The
 * editor fills what the positioner leaves, which stops short of Langy's dock while it is open;
 * beside Langy the dock stays sharp and usable, so the editor is not modal.
 */
export const WorkflowCodeEditorModalHost: WorkflowCodeEditorModalHostApi = ({
  open,
  onRequestClose,
  besideLangy,
  children,
}) => (
  <Dialog.Root
    open={open}
    onOpenChange={({ open: nextOpen }) => !nextOpen && onRequestClose()}
    closeOnEscape={false}
    modal={!besideLangy}
    closeOnInteractOutside={!besideLangy}
  >
    <Dialog.Content
      margin="8"
      width="calc(100% - 64px)"
      maxWidth="none"
      height="calc(100vh - 64px)"
      display="flex"
      flexDirection="column"
      overflow="hidden"
      pointerEvents="auto"
      backdropProps={besideLangy ? { zIndex: BETWEEN_DRAWER_AND_LANGY } : undefined}
      positionerProps={{ zIndex: 1502, pointerEvents: besideLangy ? "none" : undefined }}
    >
      {children}
    </Dialog.Content>
  </Dialog.Root>
);

/** App composition for project-scoped secret transport into the Workflow editor. */
export function CodeEditorModal({ langySubject, ...props }: EditorModalProps) {
  const { projectId, secretNames } = useEditorTransport();
  const assistant = useCodeEditorLangy({
    subject: langySubject,
    open: props.open,
    language: codeLanguageFrom({ value: props.language }),
    savedCode: props.code,
    inputs: props.inputs ?? [],
    outputs: props.outputs ?? [],
    secretNames,
  });

  return (
    <WorkflowCodeEditorModal
      {...props}
      assistant={assistant}
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
