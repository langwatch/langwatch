/**
 * Which classifier a deployment gets, and in which order the three are
 * considered.
 *
 * The order is the rule an install is entitled to rely on: a judge key of its
 * own always wins, so a deployment that configured one sends nothing to
 * LangWatch whatever else is switched on.
 *
 * @see ../index.ts
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { ConnectInstantEvalClassifier } from "@ee/licensing/connect/install/connectClassifier";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInstantEvalClassifier,
  instantEvalJudgeRoute,
  isInstantEvalClassifierAvailableForOrganization,
  isInstantEvalClassifierConfigured,
  isInstantEvalLicensedForOrganization,
  resetInstantEvalClassifier,
} from "../index";
import { JevInstantEvalClassifier } from "../jev.client";
import { NullInstantEvalClassifier } from "../null.client";

const env = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("~/env.mjs", () => ({ env }));
vi.mock("~/server/app-layer/app", () => ({ tryGetApp: () => null }));
vi.mock("~/server/db", () => ({ prisma: {} }));

const fetchSpy = vi.fn(() => {
  throw new Error("choosing a classifier attempted a network call");
});

beforeEach(async () => {
  await resetInstantEvalClassifier();
  for (const key of Object.keys(env)) delete env[key];
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockClear();
});

afterEach(async () => {
  await resetInstantEvalClassifier();
  vi.unstubAllGlobals();
});

describe("given an install that sets nothing", () => {
  describe("when the deployment picks a classifier", () => {
    /** @scenario "An install that sets nothing new keeps the classifier it had" */
    it("builds the hosted classifier and calls nothing until an organization is entitled", () => {
      expect(isInstantEvalClassifierConfigured()).toBe(true);
      expect(getInstantEvalClassifier()).toBeInstanceOf(
        ConnectInstantEvalClassifier,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe("given an install with its own judge key", () => {
  describe("when the deployment picks a classifier", () => {
    /** @scenario "An install with its own judge key keeps using it" */
    it("judges with that key rather than through the hosted service", () => {
      env.JEV_API_KEY = "a key of this install's own";

      expect(getInstantEvalClassifier()).toBeInstanceOf(
        JevInstantEvalClassifier,
      );
    });

    it("publishes the eval functions for every organization on the install", async () => {
      env.JEV_API_KEY = "a key of this install's own";

      await expect(
        isInstantEvalClassifierAvailableForOrganization("any-organization"),
      ).resolves.toBe(true);
    });
  });
});

describe("given an install with Connect switched off for an audit", () => {
  describe("when the deployment picks a classifier", () => {
    it("judges nothing and calls nothing", () => {
      env.LANGWATCH_CONNECT_DISABLED = true;

      expect(isInstantEvalClassifierConfigured()).toBe(false);
      expect(getInstantEvalClassifier()).toBeInstanceOf(
        NullInstantEvalClassifier,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe("given an install with its own judge key and the release flag off", () => {
  describe("when the access read asks whether the license releases Instant Evals", () => {
    /** @scenario "An install with its own judge key still waits for the release flag" */
    it("answers no without reading the organization, so the flag still decides", async () => {
      env.JEV_API_KEY = "a key of this install's own";

      expect(instantEvalJudgeRoute()).toBe("own_key");
      await expect(
        isInstantEvalLicensedForOrganization("any-organization"),
      ).resolves.toBe(false);
    });
  });
});

describe("given an install that judges through LangWatch", () => {
  describe("when the access read asks whether the license releases Instant Evals", () => {
    /** @scenario "A license that names Instant Evals releases them without the flag" */
    it("answers what the hosted classifier says the organization may use", async () => {
      expect(instantEvalJudgeRoute()).toBe("connect");
      const available = vi
        .spyOn(
          ConnectInstantEvalClassifier.prototype,
          "isAvailableForOrganization",
        )
        .mockResolvedValue(true);

      await expect(
        isInstantEvalLicensedForOrganization("licensed-organization"),
      ).resolves.toBe(true);
      expect(available).toHaveBeenCalledWith("licensed-organization");
      available.mockRestore();
    });
  });
});

describe("given an install with Connect switched off", () => {
  describe("when the popover asks where the judge runs", () => {
    it("says nothing can judge until Connect or a key is set", () => {
      env.LANGWATCH_CONNECT_DISABLED = true;

      expect(instantEvalJudgeRoute()).toBe("disconnected");
    });
  });
});

describe("given an install that asked for no classifier at all", () => {
  describe("when the deployment picks a classifier", () => {
    it("takes that over both a judge key and Connect", () => {
      env.INSTANT_EVAL_CLASSIFIER = "null";
      env.JEV_API_KEY = "a key of this install's own";

      expect(isInstantEvalClassifierConfigured()).toBe(false);
      expect(getInstantEvalClassifier()).toBeInstanceOf(
        NullInstantEvalClassifier,
      );
    });
  });
});
