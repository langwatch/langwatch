/**
 * @vitest-environment node
 *
 * Better Auth throttles `/api/auth/*` on its own, and works out who to count
 * from the request it is handed. These execute the step that decides what it
 * gets to see, rather than asserting on the shape of the route's source.
 */
import { describe, expect, it } from "vitest";
import { requestStatingCaller } from "../caller-header";

const signIn = (headers: Record<string, string> = {}) =>
  new Request("https://app.example.com/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email: "sam@acme.com", password: "hunter2" }),
  });

describe("requestStatingCaller()", () => {
  describe("when the application resolved a caller", () => {
    /** @scenario Better Auth counts the same caller the platform counts */
    it("states that caller on the request Better Auth is handed", () => {
      const stated = requestStatingCaller({
        request: signIn(),
        caller: "198.51.100.11",
      });

      expect(stated.headers.get("x-forwarded-for")).toBe("198.51.100.11");
    });

    it("overwrites a value the caller wrote for itself", () => {
      const stated = requestStatingCaller({
        request: signIn({ "x-forwarded-for": "203.0.113.8" }),
        caller: "198.51.100.11",
      });

      expect(stated.headers.get("x-forwarded-for")).toBe("198.51.100.11");
    });

    it("gives a forged chain no say in the answer", () => {
      const stated = requestStatingCaller({
        request: signIn({
          "x-forwarded-for": "203.0.113.8, 203.0.113.9, 10.0.0.1",
        }),
        caller: "198.51.100.11",
      });

      expect(stated.headers.get("x-forwarded-for")).toBe("198.51.100.11");
    });
  });

  describe("when no caller could be resolved", () => {
    it("removes the header rather than passing on what the caller wrote", () => {
      const stated = requestStatingCaller({
        request: signIn({ "x-forwarded-for": "203.0.113.8" }),
        caller: undefined,
      });

      expect(stated.headers.get("x-forwarded-for")).toBeNull();
    });
  });

  describe("when the request carries a body the handler still needs", () => {
    it("keeps the method, the address and the body intact", async () => {
      const stated = requestStatingCaller({
        request: signIn(),
        caller: "198.51.100.11",
      });

      expect(stated.method).toBe("POST");
      expect(stated.url).toBe("https://app.example.com/api/auth/sign-in/email");
      expect(await stated.json()).toEqual({
        email: "sam@acme.com",
        password: "hunter2",
      });
    });

    it("survives a peek at the body taken before it, as the sign-up gate takes", async () => {
      const request = signIn();
      const peeked = await request.clone().json();

      const stated = requestStatingCaller({
        request,
        caller: "198.51.100.11",
      });

      expect(peeked).toEqual({ email: "sam@acme.com", password: "hunter2" });
      expect(await stated.json()).toEqual({
        email: "sam@acme.com",
        password: "hunter2",
      });
    });
  });

  describe("when the request carries headers of its own", () => {
    it("leaves every other header where it was", () => {
      const stated = requestStatingCaller({
        request: signIn({ cookie: "a=1", "cf-connecting-ip": "203.0.113.7" }),
        caller: "198.51.100.11",
      });

      expect(stated.headers.get("cookie")).toBe("a=1");
      expect(stated.headers.get("content-type")).toBe("application/json");
      // Better Auth is told to read `x-forwarded-for` and nothing else, so a
      // vendor header is inert here; it is left alone rather than pruned so
      // this step has one job.
      expect(stated.headers.get("cf-connecting-ip")).toBe("203.0.113.7");
    });
  });
});
