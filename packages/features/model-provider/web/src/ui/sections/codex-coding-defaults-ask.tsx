import { Button, Text } from "@chakra-ui/react";
import { useEffect } from "react";
import { create } from "zustand";

import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@langwatch/design-system/dialog";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { isCodexModel, LANGY_CHAT_FEATURE_KEY } from "@langwatch/model-provider-contract";

import { modelProviderApi } from "../../behavior/model-provider-api";
import { useModelProviderHost, type ModelProviderHostPort } from "../../model/model-provider-host";
import type { ScopeAssignment } from "../../model/scope-assignment";

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

export const useCodexCodingDefaultsAskStore = create<CodexCodingDefaultsAskState>(
  (set): CodexCodingDefaultsAskState => ({
    pending: null,
    request: (ask: CodexCodingDefaultsAsk) => set({ pending: ask }),
    clear: () => set({ pending: null }),
  }),
);

/**
 * Mounted once on the model-providers settings page. Renders the queued ask,
 * except when Langy's default already resolves to a codex model: a
 * re-authentication of an existing connection would otherwise re-ask a
 * question that is already answered.
 */
export function CodexCodingDefaultsAskHost() {
  const pending = useCodexCodingDefaultsAskStore(
    (state: CodexCodingDefaultsAskState) => state.pending,
  );
  const clear = useCodexCodingDefaultsAskStore((state: CodexCodingDefaultsAskState) => state.clear);

  const resolvedDefault = modelProviderApi.modelProvider.getResolvedDefault.useQuery(
    {
      projectId: pending?.projectId ?? "",
      featureKey: LANGY_CHAT_FEATURE_KEY,
    },
    { enabled: !!pending },
  );

  // "Definitely codex already" is the only reason to skip; while the resolver
  // is still loading nothing renders, and a resolver error falls through to
  // asking (an unnecessary question beats a silently swallowed one).
  const alreadyCodex = !!resolvedDefault.data?.model && isCodexModel(resolvedDefault.data.model);
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
  host,
  projectId,
  scopes,
  onClose,
}: {
  applyDefaults: (input: { projectId: string; scopes: ScopeAssignment[] }) => Promise<unknown>;
  utils: ReturnType<typeof modelProviderApi.useUtils>;
  host: ModelProviderHostPort;
  projectId: string;
  scopes: ScopeAssignment[];
  onClose: () => void;
}): Promise<void> {
  try {
    await applyDefaults({ projectId, scopes });
    // Every default-model answer refreshes, including the Langy pill's own
    // `getResolvedDefault` — tRPC keys the cache on the procedure path, so this
    // reaches the entry langy-web's hook created. What `platform/app` also did
    // here, snapping the pill to the new model, cannot travel: that helper is
    // `@langwatch/langy-web`'s and langy-web depends on THIS package, so
    // importing it back would be a cycle. The pill's data is refreshed; only
    // the store's follow is missing.
    await utils.modelProvider.invalidate();
    host.succeeded({ title: "Codex set as the Langy and Fast default" });
    onClose();
  } catch (error) {
    if (host.isReportedGlobally(error)) return;
    host.failed({ error, fallbackTitle: "Could not set the defaults" });
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
  const apply = modelProviderApi.modelProvider.codexApplyCodingDefaults.useMutation();
  const utils = modelProviderApi.useUtils();
  const host = useModelProviderHost();

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
            across LangWatch will run on this OpenAI account's plan. The playground, evaluations and
            workflows keep their current models.
          </Text>
        </DialogBody>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button
            size="sm"
            colorPalette="orange"
            loading={apply.isPending}
            onClick={() =>
              void acceptCodexCodingDefaults({
                applyDefaults: apply.mutateAsync,
                utils,
                host,
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
