/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { readAttribution } from "../attribution";
import { useAttributionCapture } from "../useAttributionCapture";

function setUrl(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

function setReferrer(value: string) {
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value,
  });
}

describe("useAttributionCapture()", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setUrl("");
    setReferrer("");
  });

  describe("given no existing attribution in sessionStorage", () => {
    describe("when the URL contains ?ref=website", () => {
      beforeEach(() => {
        setUrl("?ref=website");
      });

      it("captures ref into lw_attrib.leadSource", () => {
        renderHook(() => useAttributionCapture());

        expect(window.sessionStorage.getItem("lw_attrib.leadSource")).toBe(
          "website",
        );
      });
    });

    describe("when the URL contains the full utm tuple", () => {
      beforeEach(() => {
        setUrl(
          "?utm_source=news&utm_medium=email&utm_campaign=apr&utm_term=agents&utm_content=cta",
        );
      });

      it("captures utm_source into lw_attrib.utmSource", () => {
        renderHook(() => useAttributionCapture());
        expect(window.sessionStorage.getItem("lw_attrib.utmSource")).toBe(
          "news",
        );
      });

      it("captures utm_medium into lw_attrib.utmMedium", () => {
        renderHook(() => useAttributionCapture());
        expect(window.sessionStorage.getItem("lw_attrib.utmMedium")).toBe(
          "email",
        );
      });

      it("captures utm_campaign into lw_attrib.utmCampaign", () => {
        renderHook(() => useAttributionCapture());
        expect(window.sessionStorage.getItem("lw_attrib.utmCampaign")).toBe(
          "apr",
        );
      });

      it("captures utm_term into lw_attrib.utmTerm", () => {
        renderHook(() => useAttributionCapture());
        expect(window.sessionStorage.getItem("lw_attrib.utmTerm")).toBe(
          "agents",
        );
      });

      it("captures utm_content into lw_attrib.utmContent", () => {
        renderHook(() => useAttributionCapture());
        expect(window.sessionStorage.getItem("lw_attrib.utmContent")).toBe(
          "cta",
        );
      });
    });

    describe("when document.referrer is set", () => {
      beforeEach(() => {
        setReferrer("https://www.langwatch.ai/");
      });

      it("captures referrer into lw_attrib.referrer", () => {
        renderHook(() => useAttributionCapture());

        expect(window.sessionStorage.getItem("lw_attrib.referrer")).toBe(
          "https://www.langwatch.ai/",
        );
      });
    });

    describe("when the URL contains an empty ref param", () => {
      beforeEach(() => {
        setUrl("?ref=");
      });

      it("does not set lw_attrib.leadSource", () => {
        renderHook(() => useAttributionCapture());

        expect(
          window.sessionStorage.getItem("lw_attrib.leadSource"),
        ).toBeNull();
      });
    });

    describe("when no attribution is present", () => {
      it("writes nothing to sessionStorage", () => {
        renderHook(() => useAttributionCapture());

        expect(window.sessionStorage.length).toBe(0);
      });
    });
  });

  describe("given lw_attrib.leadSource is already set to original", () => {
    beforeEach(() => {
      window.sessionStorage.setItem("lw_attrib.leadSource", "original");
      setUrl("?ref=later");
    });

    it("does not overwrite the first-touch value", () => {
      renderHook(() => useAttributionCapture());

      expect(window.sessionStorage.getItem("lw_attrib.leadSource")).toBe(
        "original",
      );
    });
  });
});

describe("readAttribution()", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  describe("given sessionStorage has ref, utm tuple, and referrer", () => {
    beforeEach(() => {
      window.sessionStorage.setItem("lw_attrib.leadSource", "website");
      window.sessionStorage.setItem("lw_attrib.utmSource", "news");
      window.sessionStorage.setItem("lw_attrib.utmMedium", "email");
      window.sessionStorage.setItem("lw_attrib.utmCampaign", "apr");
      window.sessionStorage.setItem("lw_attrib.utmTerm", "agents");
      window.sessionStorage.setItem("lw_attrib.utmContent", "cta");
      window.sessionStorage.setItem(
        "lw_attrib.referrer",
        "https://www.langwatch.ai/",
      );
    });

    it("exposes leadSource", () => {
      expect(readAttribution().leadSource).toBe("website");
    });

    it("exposes the full utm tuple in camelCase", () => {
      const attr = readAttribution();
      expect(attr.utmSource).toBe("news");
      expect(attr.utmMedium).toBe("email");
      expect(attr.utmCampaign).toBe("apr");
      expect(attr.utmTerm).toBe("agents");
      expect(attr.utmContent).toBe("cta");
    });

    it("exposes referrer", () => {
      expect(readAttribution().referrer).toBe("https://www.langwatch.ai/");
    });
  });

  describe("given sessionStorage is empty", () => {
    it("returns null for every field", () => {
      expect(readAttribution()).toEqual({
        leadSource: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
        referrer: null,
      });
    });
  });
});
