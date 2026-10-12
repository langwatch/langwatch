import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAILED_ACTIVE_QUERIES } from "../useRetryFailedAnalytics";

describe("FAILED_ACTIVE_QUERIES", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  afterEach(() => client.clear());

  /** Mounts a query the way a panel does and waits for its first result. */
  async function panelQuery({
    key,
    queryFn,
  }: {
    key: string;
    queryFn: () => Promise<number>;
  }) {
    const observer = new QueryObserver(client, { queryKey: [key], queryFn });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => {
      if (observer.getCurrentResult().isFetching) {
        throw new Error("still fetching");
      }
    });
    return unsubscribe;
  }

  describe("when one panel failed and another loaded", () => {
    /** @scenario "Retry in a panel refetches every failed analytics panel" */
    it("refetches only the failed panel", async () => {
      const failed = vi.fn().mockRejectedValue(new Error("memory"));
      const loaded = vi.fn().mockResolvedValue(1);
      const unsubscribeFailed = await panelQuery({
        key: "failed",
        queryFn: failed,
      });
      const unsubscribeLoaded = await panelQuery({
        key: "loaded",
        queryFn: loaded,
      });
      expect(failed).toHaveBeenCalledTimes(1);
      expect(loaded).toHaveBeenCalledTimes(1);

      await client.refetchQueries(FAILED_ACTIVE_QUERIES);

      expect(failed).toHaveBeenCalledTimes(2);
      expect(loaded).toHaveBeenCalledTimes(1);
      unsubscribeFailed();
      unsubscribeLoaded();
    });
  });

  describe("when a failed query is no longer on screen", () => {
    it("leaves it alone", async () => {
      const failed = vi.fn().mockRejectedValue(new Error("memory"));
      const unsubscribe = await panelQuery({ key: "gone", queryFn: failed });
      unsubscribe();

      await client.refetchQueries(FAILED_ACTIVE_QUERIES);

      expect(failed).toHaveBeenCalledTimes(1);
    });
  });
});
