import { useCallback, useState } from "react";
import { api } from "../utils/api";
import { toaster } from "../components/ui/toaster";

export function useDefaultModel(params: {
  projectId: string | undefined;
  initialValue: string;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}) {
  const { projectId, initialValue, onSuccess, onError } = params;
  const [value, setValue] = useState<string>(initialValue);
  const [isSaving, setIsSaving] = useState(false);
  const mutation = api.project.updateDefaultModel.useMutation();

  const update = useCallback(
    async (nextValue: string) => {
      setIsSaving(true);
      try {
        await mutation.mutateAsync({
          projectId: projectId ?? "",
          defaultModel: nextValue,
        });
        toaster.create({
          title: "Default Model Updated",
          type: "success",
          duration: 3000,
          meta: { closable: true },
        });
        onSuccess?.();
      } catch (err) {
        onError?.(err);
        toaster.create({
          title: "Failed to update default model",
          description: String(err),
          type: "error",
          duration: 4000,
          meta: { closable: true },
        });
      } finally {
        setIsSaving(false);
      }
    },
    [mutation, onError, onSuccess, projectId],
  );

  return { value, setValue, isSaving, update } as const;
}
