import { useCallback } from "react";
import { api } from "~/utils/api";

/**
 * User-scoped persistence for automatic Traces Explorer tours.
 *
 * Automatic tours fail closed while the preference is loading so a dismissed
 * tour never flashes before the server response arrives. Explicit replay from
 * the toolbar is intentionally independent from this preference.
 */
export function useTraceExplorerTourPreference() {
  const utils = api.useUtils();
  const preference = api.user.getTraceExplorerTourPreference.useQuery(
    {},
    { staleTime: Number.POSITIVE_INFINITY },
  );
  const dismissMutation = api.user.dismissTraceExplorerTour.useMutation({
    onMutate: async () => {
      await utils.user.getTraceExplorerTourPreference.cancel({});
      const previous = utils.user.getTraceExplorerTourPreference.getData({});
      utils.user.getTraceExplorerTourPreference.setData(
        {},
        {
          dismissed: true,
          dismissedAt: new Date(),
        },
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        utils.user.getTraceExplorerTourPreference.setData({}, context.previous);
      } else {
        void utils.user.getTraceExplorerTourPreference.invalidate({});
      }
    },
  });
  const persistDismissal = dismissMutation.mutate;
  const isDismissalSaving = dismissMutation.isPending;

  const dismiss = useCallback(() => {
    if (preference.data?.dismissed || isDismissalSaving) return;
    persistDismissal({});
  }, [isDismissalSaving, persistDismissal, preference.data?.dismissed]);

  return {
    dismiss,
    isDismissed: preference.data?.dismissed ?? true,
    isResolved: preference.isSuccess,
  };
}
