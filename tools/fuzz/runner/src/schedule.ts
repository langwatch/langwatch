import type { Navigation } from "./protocol.ts";

/**
 * ReloadSchedule is one lane's answer to "load the page or move inside it": a load on the
 * first visit, on every Nth after, and after a visit that left the page broken.
 */
export class ReloadSchedule {
  private sinceLoad: number | undefined;

  constructor(private readonly every: number) {}

  next(): Navigation {
    return this.sinceLoad === undefined || this.sinceLoad + 1 >= this.every ? "reload" : "in-app";
  }

  /** done takes what the visit did: a fallback load reports "reload", so it restarts the cycle. */
  done({ navigation, broken }: { navigation: Navigation; broken: boolean }): void {
    if (broken) this.sinceLoad = undefined;
    else this.sinceLoad = navigation === "reload" ? 0 : (this.sinceLoad ?? 0) + 1;
  }
}

/** loadingScale is how many times over a throttled run waits for a page still loading. */
export const loadingScale = ({ max, limit }: { max: number; limit: number }): number =>
  max / Math.max(1, limit);

/**
 * takeOnceMore takes a visit, and once more when its page crashed: a crash is the machine's,
 * never a finding. Each crash is reported; the second attempt's result stands, crashed or not.
 */
export const takeOnceMore = async <Result>({
  take,
  crashed,
  onCrash,
}: {
  take: (attempt: number) => Promise<Result>;
  crashed: (result: Result) => boolean;
  onCrash: () => void;
}): Promise<Result> => {
  const first = await take(0);
  if (!crashed(first)) return first;
  onCrash();
  const second = await take(1);
  if (crashed(second)) onCrash();
  return second;
};
