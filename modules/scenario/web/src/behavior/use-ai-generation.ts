import { useCallback, useEffect, useRef, useState } from "react";

type ModalState = "idle" | "generating" | "error";
const GENERATION_TIMEOUT_MS = 60000;

/** Keeps generation errors and timeouts with the request that owns them. */
export function useAiGeneration({
  open,
  description,
  onGenerate,
}: {
  open: boolean;
  description: string;
  onGenerate: (description: string) => Promise<void> | undefined;
}) {
  const [modalState, setModalState] = useState<ModalState>("idle");
  const [capturedError, setCapturedError] = useState<unknown>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount or when state changes
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      setModalState("idle");
      setCapturedError(null);
    }
  }, [open]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;

    // Call onGenerate first - if it returns undefined, the action was blocked
    const generationPromise = onGenerate(description);
    if (!generationPromise) return;

    // Action is proceeding - show generating state
    setModalState("generating");
    setCapturedError(null);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutRef.current = setTimeout(() => {
        reject(new Error("Generation timed out. Please try again."));
      }, GENERATION_TIMEOUT_MS);
    });

    try {
      await Promise.race([generationPromise, timeoutPromise]);
    } catch (error) {
      console.error("[AICreateModal] generation error:", error);
      setModalState("error");
      setCapturedError(error);
    } finally {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [description, onGenerate]);

  const handleTryAgain = useCallback(() => {
    void handleGenerate();
  }, [handleGenerate]);

  return { modalState, capturedError, handleGenerate, handleTryAgain };
}
