import { describe, expect, it } from "vitest";

import { contextOptions } from "../capture.ts";
import { keyed, passesFor, passPlan, withoutScheme } from "../color-scheme.ts";
import type { Plan } from "../protocol.ts";

const plan = (colorScheme?: Plan["colorScheme"]): Plan => ({
  viewport: { width: 1440, height: 900 },
  settle: { quietMillis: 500, deadlineMillis: 20_000 },
  sides: [],
  outDir: "/run/shots",
  slug: "p",
  routes: [],
  flows: [],
  credential: { projectKey: "k", email: "e", password: "p", slug: "p" },
  ...(colorScheme === undefined ? {} : { colorScheme }),
});

const capture = (key: string): { key: string } => ({ key });

describe("Feature: Visual diff colour scheme", () => {
  describe("given a run that names no scheme", () => {
    it("captures light only, as before", () => {
      expect(passesFor(undefined)).toEqual(["light"]);
      expect(passesFor("light")).toEqual(["light"]);
      expect(contextOptions({ viewport: { width: 1, height: 1 } }).colorScheme).toBe("light");
    });
  });

  describe("given -color-scheme dark", () => {
    it("captures one dark pass under the plain keys", () => {
      const collected: string[] = [];
      const collect = keyed({
        collect: (message) => collected.push(message.key),
        plan: plan("dark"),
        scheme: "dark",
      });
      collect(capture("/traces"));

      expect(passesFor("dark")).toEqual(["dark"]);
      expect(collected).toEqual(["/traces"]);
      expect(
        contextOptions({ viewport: { width: 1, height: 1 }, colorScheme: "dark" }),
      ).toHaveProperty("colorScheme", "dark");
    });
  });

  describe("given -color-scheme both", () => {
    it("runs light then dark, and only the dark pass carries the scheme in its key", () => {
      const collected: string[] = [];
      const sink = (message: { key: string }) => collected.push(message.key);
      keyed({ collect: sink, plan: plan("both"), scheme: "light" })(capture("/traces"));
      keyed({ collect: sink, plan: plan("both"), scheme: "dark" })(capture("/traces"));

      expect(passesFor("both")).toEqual(["light", "dark"]);
      expect(collected).toEqual(["/traces", "/traces@dark"]);
      expect(withoutScheme("/traces@dark")).toBe("/traces");
      expect(withoutScheme("/traces")).toBe("/traces");
    });

    it("keeps the dark pass's screenshots out of the light pass's directory", () => {
      expect(passPlan({ plan: plan("both"), scheme: "light" }).outDir).toBe("/run/shots");
      expect(passPlan({ plan: plan("both"), scheme: "dark" }).outDir).toBe("/run/shots/dark");
      expect(passPlan({ plan: plan("dark"), scheme: "dark" }).outDir).toBe("/run/shots");
      expect(passPlan({ plan: plan("both"), scheme: "dark" }).colorScheme).toBe("dark");
    });
  });
});
