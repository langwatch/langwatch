import { Button, Text } from "@chakra-ui/react";
import { useEffect } from "react";
import { create } from "zustand";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { syncLangyAfterCodingDefaultsWrite } from "~/features/langy/logic/codingDefaultSync";
import {
  isCodexModel,
  LANGY_CHAT_FEATURE_KEY,
} from "~/server/modelProviders/codexRestrictions";
import type { ScopeAssignment } from "~/server/scopes/scope.types";
import { api } from "~/utils/api";
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../ui/dialog";
import { toaster } from "../ui/toaster";

/**
 * The settings surface's post-connect question: should the just-connected
 * codex account also become the coding default? The Langy and onboarding
 * sign-ins answer it inline (setAsCodingDefaults); settings asks, because
 * someone adding a provider row is not necessarily choosing their org's
 * defaults.
 *
 * The ask is a page-level concern on purpose. The sign-in happens inside the
 * provider drawer, and the drawer closes the moment the connect completes
 * (the poll already persisted the row, so Save has nothing left to do), so a
 * dialog mounted inside it would be unmounted mid-question. The drawer
 * queues the ask here instead, and the model-providers page hosts the
 * dialog, so it opens over the refreshed provider list and survives the
 * drawer's whole lifecycle.
 */

interface CodexCodingDefaultsAsk {
  projectId: string;
  /** The scopes the sign-in just saved the provider row at. */
  scopes: ScopeAssignment[];
}

interface CodexCodingDefaultsAskState {
  pending: CodexCodingDefaultsAsk | null;
  request: (ask: CodexCodingDefaultsAsk) => void;
  clear: () => void;
}

export const useCodexCodingDefaultsAskStore =
  create<CodexCodingDefaultsAskState>((set) => ({
    pending: null,
    request: (ask) => set({ pending: ask }),
    clear: () => set({ pending: null }),
  }));

/**
 * Mounted once on the model-providers settings page. Renders the queued ask,
 * except when Langy's default already resolves to a codex model: a
 * re-authentication of an existing connection would otherwise re-ask a
 * question that is already answered.
 */
export function CodexCodingDefaultsAskHost() {
  const pending = useCodexCodingDefaultsAskStore((state) => state.pending);
  const clear = useCodexCodingDefaultsAskStore((state) => state.clear);

  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
    {
      projectId: pending?.projectId ?? "",
      featureKey: LANGY_CHAT_FEATURE_KEY,
    },
    { enabled: !!pending },
  );

  // "Definitely codex already" is the only reason to skip; while the resolver
  // is still loading nothing renders, and a resolver error falls through to
  // asking (an unnecessary question beats a silently swallowed one).
  const alreadyCodex =
    !!resolvedDefault.data?.model && isCodexModel(resolvedDefault.data.model);
  useEffect(() => {
    if (pending && alreadyCodex) clear();
  }, [pending, alreadyCodex, clear]);

  const settled = !resolvedDefault.isLoading || resolvedDefault.isError;
  if (!pending || !settled || alreadyCodex) return null;

  return (
    <CodexCodingDefaultsDialog
      open
      projectId={pending.projectId}
      scopes={pending.scopes}
      onClose={clear}
    />
  );
}

/**
 * The accept path: run the same LANGY+FAST role writes the Langy and
 * onboarding sign-ins perform inline, bring the open UI along, toast the
 * outcome, and close. On failure the error rides the toast and the dialog
 * stays open for another try.
 */
async function acceptCodexCodingDefaults({
  applyDefaults,
  utils,
  projectId,
  scopes,
  onClose,
}: {
  applyDefaults: (input: {
    projectId: string;
    scopes: ScopeAssignment[];
  }) => Promise<unknown>;
  utils: Parameters<typeof syncLangyAfterCodingDefaultsWrite>[0]["utils"];
  projectId: string;
  scopes: ScopeAssignment[];
  onClose: () => void;
}): Promise<void> {
  try {
    await applyDefaults({ projectId, scopes });
    // Refreshes every default-model cache AND snaps Langy's model pill to the
    // new default when it was following the old one, so the open panel
    // updates without a reload.
    await syncLangyAfterCodingDefaultsWrite({ utils, projectId });
    toaster.create({
      title: "Codex set as the Langy and Fast default",
      type: "success",
    });
    onClose();
  } catch (error) {
    toaster.create({
      title: "Could not set the defaults",
      description: error instanceof Error ? error.message : undefined,
      type: "error",
    });
  }
}

/**
 * The question itself: point the coding-assistant roles (Langy + the fast
 * assists) at the just-connected codex model, the same role writes the
 * Langy and onboarding flows perform inline during sign-in.
 */
export function CodexCodingDefaultsDialog({
  open,
  projectId,
  scopes,
  onClose,
}: {
  open: boolean;
  projectId: string;
  scopes: ScopeAssignment[];
  onClose: () => void;
}) {
  const apply = api.modelProvider.codexApplyCodingDefaults.useMutation();
  const utils = api.useUtils();

  return (
    <DialogRoot open={open} onOpenChange={(e) => !e.open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Codex as your coding default?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Text fontSize="sm">
            Langy and the fast AI assists
            <FieldInfoTooltip
              description="The fast assists are the small AI helpers across the product: search, chat titles, autocomplete, and translations."
              testId="codex-fast-assists-info"
            />{" "}
            across LangWatch will run on this OpenAI account's plan. The
            playground, evaluations and workflows keep their current models.
          </Text>
        </DialogBody>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button
            size="sm"
            colorPalette="orange"
            loading={apply.isLoading}
            onClick={() =>
              void acceptCodexCodingDefaults({
                applyDefaults: apply.mutateAsync,
                utils,
                projectId,
                scopes,
                onClose,
              })
            }
          >
            Set as default
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
