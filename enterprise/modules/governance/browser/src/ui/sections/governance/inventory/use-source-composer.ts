// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { useDrawer } from "@langwatch/browser-host/drawer";
import { useState } from "react";

import { api } from "../../../../behavior/governance-api.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../../behavior/governance-feedback.ts";
import type { SourceType } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import { defaultParserValues, missingRequiredParserFieldKeys } from "./parser-fields.ts";
import type { SecretDetails } from "./secret-modal-commands.ts";
import { blankComposer, type ComposerState } from "./source-composer-state.ts";
import { buildCreateInput } from "./source-submission.ts";

/** The four mutations the page drives, with their toasts and cache busting. */
function useIngestionSourceMutations({
  refetch,
  setComposing,
  setComposer,
  setSecretModal,
}: {
  refetch: () => unknown;
  setComposing: (open: boolean) => void;
  setComposer: (next: ComposerState) => void;
  setSecretModal: (details: SecretDetails | null) => void;
}) {
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const create = api.ingestionSources.create.useMutation({
    onSuccess: (data) => {
      void refetch();
      setComposing(false);
      setComposer(blankComposer());
      if (data.ingestSecret) {
        setSecretModal({
          title: "Source created - paste this secret upstream",
          secret: data.ingestSecret,
          sourceId: data.source.id,
          sourceName: data.source.name,
          sourceType: data.source.sourceType as SourceType,
        });
      } else {
        toaster.create({ title: "Source created", type: "success" });
      }
    },
    onError: (e) => showErrorToast({ error: e, fallbackTitle: "Couldn't create the source" }),
  });

  const rotate = api.ingestionSources.rotateSecret.useMutation({
    onSuccess: (data) => {
      void refetch();
      setSecretModal({
        title: "New secret minted - old one valid for 24h",
        secret: data.ingestSecret,
        sourceId: data.source.id,
        sourceName: data.source.name,
        sourceType: data.source.sourceType as SourceType,
      });
    },
    onError: (e) => showErrorToast({ error: e, fallbackTitle: "Couldn't rotate the secret" }),
  });

  const archive = api.ingestionSources.archive.useMutation({
    onSuccess: () => {
      void refetch();
      toaster.create({ title: "Source archived", type: "success" });
    },
    onError: (e) =>
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't archive the source",
      }),
  });

  return { create, rotate, archive };
}

/**
 * The composer drawer's draft and the writes it makes.
 *
 * Split from {@link useIngestionSourcesPage} because the draft, the edit
 * target and the secret reveal are one lifecycle: every mutation below has to
 * be able to close the drawer and drop the draft, so the state and the
 * mutations that reset it cannot live on opposite sides of a boundary.
 */
export function useSourceComposer({ orgId, refetch }: { orgId: string; refetch: () => void }) {
  const [composing, setComposing] = useState(false);
  const [composer, setComposer] = useState<ComposerState>(blankComposer());
  /**
   * The required fields a refused save found empty.
   *
   * Held rather than derived, because "empty" is only a complaint once the
   * admin has tried to save: marking a field red the moment the drawer opens
   * tells someone who has typed nothing yet that they have done something
   * wrong.
   */
  const [invalidFieldKeys, setInvalidFieldKeys] = useState<readonly string[]>([]);
  const { openDrawer } = useDrawer();
  const editSource = (sourceId: string) =>
    openDrawer("editIngestionSource", { urlParams: { sourceId } });
  const [secretModal, setSecretModal] = useState<SecretDetails | null>(null);
  const toaster = useGovernanceToaster();

  const mutations = useIngestionSourceMutations({
    refetch,
    setComposing,
    setComposer,
    setSecretModal,
  });

  const onSubmit = () => {
    // Named before refused. The builders answer a missing field with `null`
    // and a toast that names the whole set of fields the source type needs,
    // which leaves the admin to find which of the six they left empty by
    // reading the form against the sentence. Anything the form can point at,
    // it points at.
    const missing = missingRequiredParserFieldKeys({
      sourceType: composer.sourceType,
      values: composer.parserConfig,
    });
    setInvalidFieldKeys(missing);
    if (missing.length > 0) return;

    const input = buildCreateInput({ composer, organizationId: orgId, toaster });
    // A null input here means the form is wrong in a way no single required
    // field explains — Genie's either-or sign-in, a backfill date the adapter
    // will not parse. `resolvePullConfig` has toasted which, and the drawer
    // stays open so the user can fix it.
    if (input) mutations.create.mutate(input);
  };

  /**
   * Take a draft, and drop the complaint about any field it has now filled.
   *
   * Cleared on the way in rather than on the next save attempt: a field that
   * stays red after it has been answered reads as a second, different
   * rejection.
   */
  const updateComposer = (next: ComposerState) => {
    setComposer(next);
    setInvalidFieldKeys((keys) =>
      keys.filter((key) => (next.parserConfig[key] ?? "").trim() === ""),
    );
  };

  /**
   * Open the composer on a fresh draft for the picked type — a draft left
   * over from a different type must never leak its parser or OTTL state
   * into this one.
   */
  const startComposer = (sourceType: SourceType) => {
    setComposer({
      ...blankComposer(),
      sourceType,
      parserConfig: defaultParserValues(sourceType),
    });
    setInvalidFieldKeys([]);
    setComposing(true);
  };

  /** Close the composer and drop the draft. */
  const closeComposer = () => {
    setComposing(false);
    setComposer(blankComposer());
    setInvalidFieldKeys([]);
  };

  return {
    startComposer,
    closeComposer,
    composing,
    setComposing,
    composer,
    setComposer: updateComposer,
    invalidFieldKeys,
    editSource,
    secretModal,
    setSecretModal,
    mutations,
    onSubmit,
  };
}
