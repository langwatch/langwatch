/**
 * Spec: specs/features/customer-io-nurturing-integration.feature (R14)
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { readAttribution } from "../attribution";
import { useAttributionCapture } from "../use-attribution-capture";

function setUrl(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

function setReferrer(value: string) {
  Object.defineProperty(document, "referrer", { configurable: true, value });
}

describe("useAttributionCapture", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setUrl("");
    setReferrer("");
  });

  describe("given no existing attribution in sessionStorage", () => {
    describe("when the URL carries ref", () => {
      beforeEach(() => setUrl("?ref=website"));

      /** @scenario "Attribution hook captures ref param in sessionStorage on first touch" */
      it("captures ref into lw_attrib.leadSource", () => {
        renderHook(() => useAttributionCapture());

        expect(window.sessionStorage.getItem("lw_attrib.leadSource")).toBe("website");
      });
    });

    describe("when the URL carries the full utm tuple", () => {
      beforeEach(() =>
        setUrl(
          "?utm_source=news&utm_medium=email&utm_campaign=apr&utm_term=agents&utm_content=cta",
        ),
      );

      /** @scenario "Attribution hook captures full utm tuple when present in URL" */
      it("captures all five utm params under their lw_attrib keys", () => {
        renderHook(() => useAttributionCapture());

        expect(window.sessionStorage.getItem("lw_attrib.utmSource")).toBe("news");
        expect(window.sessionStorage.getItem("lw_attrib.utmMedium")).toBe("email");
        expect(window.sessionStorage.getItem("lw_attrib.utmCampaign")).toBe("apr");
        expect(window.sessionStorage.getItem("lw_attrib.utmTerm")).toBe("agents");
        expect(window.sessionStorage.getItem("lw_attrib.utmContent")).toBe("cta");
      });

      it("reads the tuple back through readAttribution", () => {
        renderHook(() => useAttributionCapture());

        expect(readAttribution().utmCampaign).toBe("apr");
      });
    });

    describe("when the document has a referrer", () => {
      beforeEach(() => setReferrer("https://www.langwatch.ai/"));

      /** @scenario "Attribution hook captures document.referrer when present" */
      it("captures the referrer into lw_attrib.referrer", () => {
        renderHook(() => useAttributionCapture());

        expect(window.sessionStorage.getItem("lw_attrib.referrer")).toBe(
          "https://www.langwatch.ai/",
        );
      });
    });

    describe("when the referrer carries a query string and a fragment", () => {
      beforeEach(() => setReferrer("https://example.com/page?token=secret#section"));

      it("stores the referrer without its query or fragment", () => {
        renderHook(() => useAttributionCapture());

        expect(window.sessionStorage.getItem("lw_attrib.referrer")).toBe(
          "https://example.com/page",
        );
      });
    });

    describe("when the URL carries an empty ref", () => {
      beforeEach(() => setUrl("?ref="));

      it("records no lead source", () => {
        renderHook(() => useAttributionCapture());

        expect(window.sessionStorage.getItem("lw_attrib.leadSource")).toBeNull();
      });
    });

    describe("when the address carries no attribution at all", () => {
      it("writes nothing", () => {
        renderHook(() => useAttributionCapture());

        expect(window.sessionStorage.length).toBe(0);
      });
    });
  });

  describe("given lw_attrib.leadSource already holds a first-touch value", () => {
    beforeEach(() => {
      window.sessionStorage.setItem("lw_attrib.leadSource", "original");
      setUrl("?ref=later");
    });

    /** @scenario "Attribution hook does not overwrite existing first-touch values" */
    it("keeps the first-touch value", () => {
      renderHook(() => useAttributionCapture());

      expect(window.sessionStorage.getItem("lw_attrib.leadSource")).toBe("original");
    });
  });
});
