/**
 * The four routing-policy mutations, with their invalidation and their toasts
 * in one place so the page and the drawer cannot drift about what a successful
 * save looks like.
 *
 * Returns state and callbacks only, never JSX.
 */
import { useGatewayToaster, useShowErrorToast } from "../../../behavior/gateway-feedback";
import { useCallback, useState } from "react";

import { describeError } from "../../../model/describe-error";
import { api } from "../../../behavior/gateway-api";

import {
  modelAliasesFromForm,
  type RoutingPolicyFormValues,
  restrictionsToPayload,
} from "../model/routing-policy-form";

export interface UseRoutingPolicyMutationsInput {
  organizationId: string;
  /** Called after a create or an update lands, so the drawer can close itself. */
  onSaved?: () => void;
}

export function useRoutingPolicyMutations({
  organizationId,
  onSaved,
}: UseRoutingPolicyMutationsInput) {
  const toaster = useGatewayToaster();
  const utils = api.useUtils();
  const refetch = useCallback(
    () => utils.routingPolicy.list.invalidate({ organizationId }),
    [utils, organizationId],
  );

  /**
   * A save error is shown inside the drawer rather than as a toast: the form
   * that failed is still on screen, and a toast racing the drawer overlay is
   * how a rejected save came to look like a no-op.
   */
  const [saveError, setSaveError] = useState<string | null>(null);
  const clearSaveError = useCallback(() => setSaveError(null), []);

  const onSaveSuccess = useCallback(
    (title: string) => {
      void refetch();
      setSaveError(null);
      toaster.create({ title, type: "success" });
      onSaved?.();
    },
    [refetch, onSaved],
  );

  const create = api.routingPolicy.create.useMutation({
    onSuccess: () => onSaveSuccess("Routing policy created"),
    onError: (error) =>
      setSaveError(
        describeError({
          error,
          fallbackTitle: "Couldn't create the routing policy",
        }),
      ),
  });

  const update = api.routingPolicy.update.useMutation({
    onSuccess: () => onSaveSuccess("Routing policy updated"),
    onError: (error) =>
      setSaveError(
        describeError({
          error,
          fallbackTitle: "Couldn't save the routing policy",
        }),
      ),
  });

  const { setDefault, remove } = useListMutations(refetch);

  const save = useCallback(
    ({
      policyId,
      values,
    }: {
      policyId: string | null;
      values: RoutingPolicyFormValues;
    }) => {
      setSaveError(null);
      const shared = sharedSaveFields({ organizationId, values });
      if (policyId) {
        update.mutate({ ...shared, id: policyId });
        return;
      }
      create.mutate({
        ...shared,
        scopes: values.scopes.map((scope) => ({
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
        })),
        isDefault: values.isDefault,
      });
    },
    [create, update, organizationId],
  );

  return {
    save,
    isSaving: create.isPending || update.isPending,
    saveError,
    clearSaveError,
    setDefault,
    remove,
  };
}

/** The fields a create and an update both write. */
function sharedSaveFields({
  organizationId,
  values,
}: {
  organizationId: string;
  values: RoutingPolicyFormValues;
}) {
  return {
    organizationId,
    name: values.name.trim(),
    description: values.description.trim() || null,
    modelProviderIds: values.modelProviderIds,
    modelAliases: modelAliasesFromForm(values),
    defaultModel: values.defaultModel.trim() || null,
    policyRules: restrictionsToPayload(values),
  };
}

/**
 * The two mutations driven from the list rather than the editor. Their
 * failures are toasts, because the row they were fired from is still there
 * and has nowhere of its own to say so.
 */
function useListMutations(refetch: () => Promise<unknown> | void) {
  const toaster = useGatewayToaster();
  const showErrorToast = useShowErrorToast();
  const setDefault = api.routingPolicy.setDefault.useMutation({
    onSuccess: () => {
      void refetch();
      toaster.create({ title: "Default policy updated", type: "success" });
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't set the default policy",
      }),
  });

  const remove = api.routingPolicy.delete.useMutation({
    onSuccess: () => {
      void refetch();
      toaster.create({ title: "Routing policy deleted", type: "success" });
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't delete the routing policy",
      }),
  });

  return { setDefault, remove };
}
