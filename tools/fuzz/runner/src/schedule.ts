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
