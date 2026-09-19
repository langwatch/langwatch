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
  isInstantEvalClassifierAvailableForOrganization,
  isInstantEvalClassifierConfigured,
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
    it("gets the classifier for an install with no judge key, and calls nothing", () => {
      expect(isInstantEvalClassifierConfigured()).toBe(false);
      expect(getInstantEvalClassifier()).toBeInstanceOf(
        NullInstantEvalClassifier,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe("given an install with its own judge key", () => {
  describe("when the deployment picks a classifier", () => {
    /** @scenario "An install with its own judge key keeps using it" */
    it("judges with that key even where Connect is switched on", () => {
      env.JEV_API_KEY = "a key of this install's own";
      env.LANGWATCH_CONNECT_ENABLED = true;

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

describe("given an install with Connect switched on and no judge key", () => {
  describe("when the deployment picks a classifier", () => {
    it("judges through the hosted service", () => {
      env.LANGWATCH_CONNECT_ENABLED = true;

      expect(isInstantEvalClassifierConfigured()).toBe(true);
      expect(getInstantEvalClassifier()).toBeInstanceOf(
        ConnectInstantEvalClassifier,
      );
    });
  });
});

describe("given an install that asked for no classifier at all", () => {
  describe("when the deployment picks a classifier", () => {
    it("takes that over both a judge key and Connect", () => {
      env.INSTANT_EVAL_CLASSIFIER = "null";
      env.JEV_API_KEY = "a key of this install's own";
      env.LANGWATCH_CONNECT_ENABLED = true;

      expect(isInstantEvalClassifierConfigured()).toBe(false);
      expect(getInstantEvalClassifier()).toBeInstanceOf(
        NullInstantEvalClassifier,
      );
    });
  });
});
