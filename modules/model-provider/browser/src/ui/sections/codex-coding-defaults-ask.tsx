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

import { modelProviderApi } from "../../behavior/model-provider-api.ts";
import { useModelProviderHost, type ModelProviderHostApi } from "../../model/model-provider-host.ts";
import type { ScopeAssignment } from "../../model/scope-assignment.ts";

/**
 * Settings asks post-connect (unlike Langy/onboarding, which set it inline) since adding a row
 * isn't necessarily choosing org defaults. Queued here, not shown in-drawer, because the drawer
 * closes the moment connect completes and would unmount a dialog mid-question.
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
 * except when Langy's default already resolves to a codex model — otherwise
 * a re-authentication would re-ask an already-answered question.
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
 * onboarding sign-ins perform inline, bring the open UI along, toast, and
 * close. On failure the error rides the toast and the dialog stays open.
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
  host: ModelProviderHostApi;
  projectId: string;
  scopes: ScopeAssignment[];
  onClose: () => void;
}): Promise<void> {
  try {
    await applyDefaults({ projectId, scopes });
    // Every default-model answer refreshes, including the Langy pill's own
    // `getResolvedDefault` (tRPC keys the cache on the procedure path). What
    // `platform/app` also did here — snapping the pill to the new model —
    // can't travel: that helper is `@langwatch/langy-browser`'s, and langy-web
    // depends on THIS package, so importing it back would be a cycle.
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
