import { api } from "../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../behavior/ops-feedback.ts";

/** The notice writes, each one invalidating the list. */
export function useSelfHostedNoticeCommands() {
  const utils = api.useContext();
  const toaster = useOpsToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = async () => {
    await utils.selfHostedNotices.invalidate();
  };

  return {
    create: api.selfHostedNotices.create.useMutation({
      onSuccess: refresh,
      onError: (error: unknown) =>
        showErrorToast({ error, fallbackTitle: "The notice was not saved" }),
    }),
    update: api.selfHostedNotices.update.useMutation({
      onSuccess: refresh,
      onError: (error: unknown) =>
        showErrorToast({ error, fallbackTitle: "The notice was not saved" }),
    }),
    publish: api.selfHostedNotices.publish.useMutation({
      onSuccess: async () => {
        await refresh();
        toaster.create({
          title: "Notice published: installs see it after their next daily report",
          type: "success",
          duration: 4000,
        });
      },
      onError: (error: unknown) =>
        showErrorToast({ error, fallbackTitle: "The notice was not published" }),
    }),
    withdraw: api.selfHostedNotices.withdraw.useMutation({
      onSuccess: async () => {
        await refresh();
        toaster.create({ title: "Notice withdrawn", type: "success", duration: 3000 });
      },
      onError: (error: unknown) =>
        showErrorToast({ error, fallbackTitle: "The notice was not withdrawn" }),
    }),
  };
}
