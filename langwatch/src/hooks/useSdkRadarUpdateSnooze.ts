import { useLocalStorage } from "usehooks-ts";

const SNOOZE_DAYS = 30;

export function useSdkRadarUpdateSnooze(projectId: string | undefined) {
  const [snoozeExpiry, setSnoozeExpiry] = useLocalStorage<string | null>(
    `langwatch-sdk-radar-snooze-${projectId ?? ""}`,
    null,
  );

  const isSnoozed = snoozeExpiry
    ? new Date().toISOString() < snoozeExpiry
    : false;

  const snooze = () => {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + SNOOZE_DAYS);
    setSnoozeExpiry(expiry.toISOString());
  };

  return { isSnoozed, snooze };
}
