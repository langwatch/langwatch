import { useCallback, useMemo, useRef, useState } from "react";
import { shouldShowGenericTranslateError } from "~/components/messages/translationError";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export interface UseTextTranslationResult {
  /** The texts to render: translations when active, originals otherwise. */
  displayTexts: Record<string, string>;
  /** Whether the translated variant is currently shown. */
  isActive: boolean;
  /** Whether a translation request is in flight. */
  isLoading: boolean;
  /** Translate-and-show, or flip back to the originals. */
  toggle: () => void;
}

/**
 * Shared translate-to-English state for trace-drawer surfaces (Summary
 * input/output panels, conversation turns). Wraps the same
 * `translate.translate` mutation the legacy messages view uses, so
 * model-config failures surface through the same typed-error toasts
 * (missing model popup, provider disabled, AI call failed) raised by the
 * global tRPC interceptor. Translations are cached against the source
 * texts — toggling back and forth never refetches; new source texts
 * invalidate the cache.
 *
 * See specs/traces-v2/message-translation.feature.
 */
export function useTextTranslation({
  texts,
}: {
  texts: Record<string, string>;
}): UseTextTranslationResult {
  const { project } = useOrganizationTeamProject();
  const translateAPI = api.translate.translate.useMutation();
  const [isActive, setIsActive] = useState(false);
  const [translations, setTranslations] = useState<Record<
    string,
    string
  > | null>(null);
  const cachedForRef = useRef<string | null>(null);

  const sourceKey = JSON.stringify(texts);

  const toggle = useCallback(() => {
    if (isActive) {
      setIsActive(false);
      return;
    }
    if (cachedForRef.current === sourceKey) {
      setIsActive(true);
      return;
    }
    const entries = Object.entries(texts).filter(
      ([, value]) => value.trim().length > 0,
    );
    if (entries.length === 0 || !project?.id) return;

    Promise.all(
      entries.map(([key, value]) =>
        translateAPI
          .mutateAsync({ projectId: project.id, textToTranslate: value })
          .then((result) => [key, result.translation] as const),
      ),
    )
      .then((pairs) => {
        setTranslations(Object.fromEntries(pairs));
        cachedForRef.current = sourceKey;
        setIsActive(true);
      })
      .catch((error: unknown) => {
        // The typed-error toasts (missing model / provider disabled /
        // AI call failed) are raised by the global tRPC error handler in
        // utils/api.tsx; only fall back to a generic toast when none of
        // those matched, so a non-typed failure still gives feedback.
        if (shouldShowGenericTranslateError(error)) {
          toaster.create({
            title: "Error translating",
            description:
              "There was an error translating the message, please try again.",
            type: "error",
            meta: { closable: true },
          });
        }
      });
  }, [isActive, project?.id, sourceKey, texts, translateAPI]);

  // Only overlay translations that belong to the CURRENT source texts —
  // when the content changes while active, fall back to originals until
  // the user re-translates.
  const displayTexts = useMemo(
    () =>
      isActive && translations && cachedForRef.current === sourceKey
        ? { ...texts, ...translations }
        : texts,
    [isActive, translations, texts, sourceKey],
  );

  return {
    displayTexts,
    isActive,
    isLoading: translateAPI.isLoading,
    toggle,
  };
}
