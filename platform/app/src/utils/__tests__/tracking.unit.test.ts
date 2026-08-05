/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("trackEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    window.localStorage.clear();
    delete (window as any).gtag;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given gtag already exists", () => {
    it("sends the event immediately with params", async () => {
      const gtag = vi.fn();
      (window as any).gtag = gtag;
      const { trackEvent } = await import("../tracking");

      trackEvent("workflow_create", { project_id: "p1" });

      expect(gtag).toHaveBeenCalledWith("event", "workflow_create", {
        project_id: "p1",
      });
    });

    it("sends the event without a params argument when params is undefined", async () => {
      const gtag = vi.fn();
      (window as any).gtag = gtag;
      const { trackEvent } = await import("../tracking");

      trackEvent("side_menu_toggle", undefined);

      expect(gtag).toHaveBeenCalledWith("event", "side_menu_toggle");
    });
  });

  describe("given gtag is not yet available", () => {
    it("sends the event once gtag appears via polling", async () => {
      const { trackEvent } = await import("../tracking");

      trackEvent("workflow_create", { project_id: "p1" });

      const gtag = vi.fn();
      (window as any).gtag = gtag;
      await vi.advanceTimersByTimeAsync(250);

      expect(gtag).toHaveBeenCalledWith("event", "workflow_create", {
        project_id: "p1",
      });
    });

    it("gives up after the poll timeout without throwing", async () => {
      const { trackEvent } = await import("../tracking");

      expect(() => trackEvent("workflow_create", {})).not.toThrow();
      await vi.advanceTimersByTimeAsync(10_000);
    });
  });
});

describe("trackEventOnce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    window.localStorage.clear();
    delete (window as any).gtag;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given the event has not been tracked before", () => {
    it("sends the event and marks it tracked in localStorage", async () => {
      const gtag = vi.fn();
      (window as any).gtag = gtag;
      const { trackEventOnce } = await import("../tracking");

      trackEventOnce("organization_initialized", { project_id: "p1" });

      expect(gtag).toHaveBeenCalledWith("event", "organization_initialized", {
        project_id: "p1",
      });
      expect(
        JSON.parse(window.localStorage.getItem("events_tracked") ?? "[]"),
      ).toContain("organization_initialized");
    });
  });

  describe("given the event was already tracked in a prior session", () => {
    it("does not send the event again", async () => {
      window.localStorage.setItem(
        "events_tracked",
        JSON.stringify(["organization_initialized"]),
      );
      const gtag = vi.fn();
      (window as any).gtag = gtag;
      const { trackEventOnce } = await import("../tracking");

      trackEventOnce("organization_initialized", {});

      expect(gtag).not.toHaveBeenCalled();
    });
  });

  describe("given gtag is not yet available", () => {
    it("does not mark the event tracked until gtag appears and the event actually sends", async () => {
      const { trackEventOnce } = await import("../tracking");

      trackEventOnce("organization_initialized", { project_id: "p1" });

      expect(
        JSON.parse(window.localStorage.getItem("events_tracked") ?? "[]"),
      ).not.toContain("organization_initialized");

      const gtag = vi.fn();
      (window as any).gtag = gtag;
      await vi.advanceTimersByTimeAsync(250);

      expect(gtag).toHaveBeenCalledWith("event", "organization_initialized", {
        project_id: "p1",
      });
      expect(
        JSON.parse(window.localStorage.getItem("events_tracked") ?? "[]"),
      ).toContain("organization_initialized");
    });

    describe("when called again before the first poll resolves", () => {
      it("only sends the event once", async () => {
        const { trackEventOnce } = await import("../tracking");

        trackEventOnce("organization_initialized", { project_id: "p1" });
        trackEventOnce("organization_initialized", { project_id: "p1" });

        const gtag = vi.fn();
        (window as any).gtag = gtag;
        await vi.advanceTimersByTimeAsync(250);

        expect(gtag).toHaveBeenCalledTimes(1);
      });
    });
  });
});
