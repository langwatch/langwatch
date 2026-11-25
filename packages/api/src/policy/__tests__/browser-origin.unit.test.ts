import { describe, expect, it } from "vitest";

import { BrowserOriginGuard } from "../browser-origin.ts";

const fromHeaders = (headers: Record<string, string>) => ({
  req: { header: (name: string) => headers[name] },
});

describe("BrowserOriginGuard", () => {
  it.each(["same-origin", "none"])("accepts Sec-Fetch-Site %s", (site) => {
    expect(BrowserOriginGuard.isFromOwnOrigin(fromHeaders({ "sec-fetch-site": site }))).toBe(true);
  });

  /** @scenario "A write from a foreign origin is refused" */
  it.each(["cross-site", "same-site"])("refuses Sec-Fetch-Site %s", (site) => {
    const request = fromHeaders({ "sec-fetch-site": site, host: "app.example" });

    expect(BrowserOriginGuard.isFromOwnOrigin(request)).toBe(false);
  });
});

describe("BrowserOriginGuard.isOwnEventStream", () => {
  const eventStream = { accept: "text/event-stream", host: "langwatch.internal:5560" };

  describe("given a deployment served over plain HTTP", () => {
    /** @scenario "A same-origin live stream on a plain-HTTP install opens" */
    it("accepts an unsignalled request asking for an event stream", () => {
      expect(
        BrowserOriginGuard.isOwnEventStream(fromHeaders(eventStream), { plainHttp: true }),
      ).toBe(true);
    });

    /** @scenario "A navigation to the live update channel on a plain-HTTP install is refused" */
    it("refuses an unsignalled navigation, which asks for a document", () => {
      const navigation = fromHeaders({ accept: "text/html,*/*;q=0.8", host: eventStream.host });

      expect(BrowserOriginGuard.isOwnEventStream(navigation, { plainHttp: true })).toBe(false);
    });

    it("refuses an event stream from a foreign origin", () => {
      const foreign = fromHeaders({ ...eventStream, origin: "http://attacker.example" });

      expect(BrowserOriginGuard.isOwnEventStream(foreign, { plainHttp: true })).toBe(false);
    });

    it("refuses a cross-site Sec-Fetch-Site whatever it asks for", () => {
      const crossSite = fromHeaders({ ...eventStream, "sec-fetch-site": "cross-site" });

      expect(BrowserOriginGuard.isOwnEventStream(crossSite, { plainHttp: true })).toBe(false);
    });
  });

  describe("given a deployment served over HTTPS", () => {
    /** @scenario "An HTTPS install keeps refusing an unsignalled live stream" */
    it("refuses an unsignalled event stream, as isFromOwnOrigin does", () => {
      expect(
        BrowserOriginGuard.isOwnEventStream(fromHeaders(eventStream), { plainHttp: false }),
      ).toBe(false);
    });

    it("accepts Sec-Fetch-Site same-origin", () => {
      const sameOrigin = fromHeaders({ ...eventStream, "sec-fetch-site": "same-origin" });

      expect(BrowserOriginGuard.isOwnEventStream(sameOrigin, { plainHttp: false })).toBe(true);
    });
  });
});
