// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetCarriedEmail,
  forgotPasswordHref,
  readCarriedAddressProof,
  readCarriedEmail,
  signUpHref,
} from "../carried-email.ts";

/**
 * The address is carried in the URL FRAGMENT: it never reaches the server,
 * so it lands in no access log and no `Referer`. These pin that promise —
 * nothing writes it into the query, and the reading screen clears it after.
 */
describe("given an address carried between the front door's two screens", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/auth/signup");
  });

  describe("when the sign-up link is built with an address", () => {
    /** @scenario An address carried between the two screens never reaches the server */
    it("keeps the address out of the query string entirely", () => {
      const href = signUpHref({
        callbackUrl: "/",
        email: "someone@example.com",
      });

      const [beforeFragment] = href.split("#");
      expect(beforeFragment).not.toContain("someone");
      expect(beforeFragment).not.toContain("email");
    });

    it("carries it in the fragment, where the browser keeps it", () => {
      const href = signUpHref({ callbackUrl: "/", email: "a@b.com" });

      expect(href).toBe("/auth/signup?callbackUrl=%2F#email=a%40b.com");
    });

    it("carries the callback in the query, which the app still needs", () => {
      const href = signUpHref({ callbackUrl: "/dashboard", email: null });

      expect(href).toBe("/auth/signup?callbackUrl=%2Fdashboard");
    });

    it("survives a plus-tagged address, which reads as a space unescaped", () => {
      const email = "alex+hu7guh@langwatch.ai";
      window.history.replaceState(null, "", signUpHref({ callbackUrl: "/", email }));

      expect(readCarriedEmail()).toBe(email);
    });
  });

  describe("when the sign-up link carries an unconfirmed address proof", () => {
    it("keeps the proof in the fragment beside the address, never in the query", () => {
      const href = signUpHref({ callbackUrl: "/", email: "a@b.com", addressProof: "p-1" });

      expect(href).toBe("/auth/signup?callbackUrl=%2F#email=a%40b.com&proof=p-1");
      window.history.replaceState(null, "", href);
      expect(readCarriedEmail()).toBe("a@b.com");
      expect(readCarriedAddressProof()).toBe("p-1");
    });

    it("carries no proof without the address it stands for", () => {
      expect(signUpHref({ email: null, addressProof: "p-1" })).toBe("/auth/signup");
    });
  });

  describe("when the forgot-password link is built from the address just typed", () => {
    it("carries it in the fragment and never in the query", () => {
      const href = forgotPasswordHref({ email: "alex+reset@langwatch.ai" });

      expect(href).toBe("/auth/forgot-password#email=alex%2Breset%40langwatch.ai");
      window.history.replaceState(null, "", href);
      expect(readCarriedEmail()).toBe("alex+reset@langwatch.ai");
    });

    it("links to the bare screen when no address was typed", () => {
      expect(forgotPasswordHref({ email: "" })).toBe("/auth/forgot-password");
    });
  });

  describe("when the sign-up screen reads what it was handed", () => {
    it("finds the address the log-in door carried over", () => {
      window.history.replaceState(null, "", "/auth/signup#email=a%40b.com");

      expect(readCarriedEmail()).toBe("a@b.com");
    });

    it("answers nothing for a browser that arrived carrying nothing", () => {
      expect(readCarriedEmail()).toBeUndefined();
    });
  });

  describe("when the screen has read it", () => {
    it("takes the address back out of the address bar", () => {
      window.history.replaceState(null, "", "/auth/signup?callbackUrl=%2F#email=a%40b.com");

      forgetCarriedEmail();

      expect(window.location.hash).toBe("");
      expect(readCarriedEmail()).toBeUndefined();
    });

    it("leaves the rest of the URL where it was", () => {
      window.history.replaceState(null, "", "/auth/signup?callbackUrl=%2F#email=a%40b.com");

      forgetCarriedEmail();

      expect(window.location.pathname).toBe("/auth/signup");
      expect(window.location.search).toBe("?callbackUrl=%2F");
    });
  });
});
