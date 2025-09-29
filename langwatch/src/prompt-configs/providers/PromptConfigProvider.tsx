import type { PromptScope } from "@prisma/client";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

import type { VersionedPrompt } from "~/server/prompt-config";

import { ChangeHandleDialog } from "../forms/ChangeHandleDialog";
import {
  SaveVersionDialog,
  type SaveDialogFormValues,
} from "../forms/SaveVersionDialog";
import type { ChangeHandleFormValues } from "../forms/schemas/change-handle-form.schema";
import { usePrompts } from "../hooks/usePrompts";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { type RouterInputs } from "~/utils/api";

export type TriggerSaveVersionParams = RouterInputs["prompts"]["upsert"]['data'] & {
  handle: string | null;
};

type TrigggerSaveVersionFunction = ({
  data,
  onError,
  onSuccess,
}: {
  data: TriggerSaveVersionParams;
  onError?: (error: Error) => void;
  onSuccess?: (prompt: VersionedPrompt) => void;
}) => void;

interface PromptConfigContextType {
  triggerSaveVersion: TrigggerSaveVersionFunction;
  triggerChangeHandle: TrigggerSaveVersionFunction;
}

const PromptConfigContext = createContext<PromptConfigContextType>({
  triggerSaveVersion: () => {
    throw new Error("No triggerSaveVersion function provided");
  },
  triggerChangeHandle: () => {
    throw new Error("No triggerChangeHandle function provided");
  },
});

export const usePromptConfigContext = () => {
  const context = useContext(PromptConfigContext);
  if (!context) {
    throw new Error(
      "usePromptConfigContext must be used within a PromptConfigProvider"
    );
  }
  return context;
};

interface SaveDialogData {
  handle?: string | null;
  scope?: PromptScope;
  needsHandleChange?: boolean;
}

/**
 * Provider for prompt configuration operations.
 * Single Responsibility: Manages the save flow for prompt configurations.
 */
export function PromptConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { projectId } = useOrganizationTeamProject();
  const [saveDialogData, setSaveDialogData] = useState<SaveDialogData | null>(
    null
  );
  const saveClosureRef = useRef<
    | ((params: {
        handle: string; // Enforce that handle is always provide
        scope?: PromptScope;
        commitMessage: string;
      }) => Promise<void>)
    | null
  >(null);
  const { upsertPrompt } = usePrompts();

  const closeDialog = useCallback(() => {
    setSaveDialogData(null);
  }, []);

  const setSaveClosure = useCallback(
    (
      data: TriggerSaveVersionParams,
      onError?: (error: Error) => void,
      onSuccess?: (prompt: VersionedPrompt) => void
    ) => {
      if (!projectId) throw new Error("Project ID is required");

      // Create the closure with all the save parameters
      saveClosureRef.current = async ({ handle, scope, commitMessage }) => {
        try {
          const prompt = await upsertPrompt({
            handle,
            projectId,
            data: {
              ...data,
              scope: data.scope ?? scope,
              commitMessage,
            },
          });

          if (prompt.version === 1) {
            toaster.create({
              title: "Prompt created",
              description:
                "Prompt configuration has been created successfully.",
              type: "success",
            });
          } else {
            toaster.create({
              title: "Prompt saved",
              description: "Prompt configuration has been saved successfully.",
              type: "success",
            });
          }

          closeDialog();
          onSuccess?.(prompt);
        } catch (error) {
          toaster.create({
            title: "Failed to save",
            description:
              error instanceof Error ? error.message : "Please try again.",
            type: "error",
          });
          onError?.(error as Error);
        }
      };
    },
    [closeDialog, upsertPrompt, projectId]
  );

  const triggerSaveVersion: PromptConfigContextType["triggerSaveVersion"] =
    useCallback(
      ({ data, onError, onSuccess }) => {
        if (!data) return;
        setSaveDialogData({
          handle: data.handle,
          scope: data.scope,
          needsHandleChange: !data.handle,
        });
        setSaveClosure(data, onError, onSuccess);
      },
      [setSaveClosure]
    );

  const triggerChangeHandle: PromptConfigContextType["triggerSaveVersion"] =
    useCallback(
      ({ data, onError, onSuccess }) => {
        if (!data) return;
        setSaveDialogData({
          handle: data.handle,
          scope: data.scope,
          needsHandleChange: true,
        });
        setSaveClosure({
          ...data,
          commitMessage: `Handle changed to ${data.handle}`,
        }, onError, onSuccess);
      },
      [setSaveClosure]
    );

  const isChangeHandleDialogOpen =
    !!saveDialogData && saveDialogData.needsHandleChange;
  const isSaveDialogOpen =
    !!saveDialogData && !saveDialogData.needsHandleChange;

  return (
    <PromptConfigContext.Provider
      value={{ triggerSaveVersion, triggerChangeHandle }}
    >
      {children}
        <ChangeHandleDialog
          currentHandle={saveDialogData?.handle}
          currentScope={saveDialogData?.scope}
          isOpen={Boolean(isChangeHandleDialogOpen)}
          onClose={closeDialog}
          onSubmit={async (formValues: ChangeHandleFormValues) => {
            if (!saveClosureRef.current) return;
            await saveClosureRef.current({
              handle: formValues.handle,
              scope: formValues.scope,
              commitMessage: "Initial version",
            });
          }}
        />
        <SaveVersionDialog
          isOpen={isSaveDialogOpen}
          onClose={closeDialog}
          onSubmit={async (formValues: SaveDialogFormValues) => {
            if (!saveClosureRef.current) return;
            if (!saveDialogData?.handle) throw new Error("Handle is required"); // should never happen
            await saveClosureRef.current({
              handle: saveDialogData?.handle,
              commitMessage: formValues.commitMessage,
            });
          }}
        />
    </PromptConfigContext.Provider>
  );
}
