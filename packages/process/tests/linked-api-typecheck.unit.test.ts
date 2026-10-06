import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { defineProcessModule } from "../src/feature-installer.ts";
import { createApp } from "../src/process-supply.ts";
import { licenseConsumerModule, licenseSource } from "./process-supply.fixtures.ts";

interface AnnotationApi {
  list(): Promise<string[]>;
  find(id: string): Promise<string | null>;
}
const AnnotationApi = moduleApi<AnnotationApi>()("annotation");

class CompleteAnnotationApp implements AnnotationApi {
  static readonly contract = AnnotationApi;
  static readonly dependencies = {};

  static create() {
    return new CompleteAnnotationApp();
  }

  async list(): Promise<string[]> {
    return [];
  }
  async find(_id: string): Promise<string | null> {
    return null;
  }
}

class PartialAnnotationApp {
  static readonly contract = AnnotationApi;
  static readonly dependencies = {};

  static create() {
    return new PartialAnnotationApp();
  }

  async list(): Promise<string[]> {
    return [];
  }
}

/** Never called: the proof is that `pnpm typecheck` accepts the directive as used. */
function selectIncompleteApp() {
  // @ts-expect-error the factory returns an object missing the linked API's `find`
  return defineProcessModule("annotation").withApi(PartialAnnotationApp);
}

/** Never called: the proof is that `pnpm typecheck` accepts the directive as used. */
function provideWidenedClient() {
  const widened: {} = licenseSource;
  const consumer = createApp({ role: "api" }).withModules([licenseConsumerModule]);
  // @ts-expect-error a client widened to an empty object no longer implements the interface
  return consumer.provide({ licenseSource: widened });
}

describe("given a server app linked to an annotation API with callable use cases", () => {
  describe("when its factory returns an object missing one use case", () => {
    /** @scenario "An app must implement its linked callable API" */
    it("is selectable through withApi only when the factory implements every use case", () => {
      expect(
        defineProcessModule("annotation").withApi(CompleteAnnotationApp).build(),
      ).toBeDefined();
      expect(selectIncompleteApp).toBeTypeOf("function");
    });
  });
});

describe("given a root providing an implementation through a feature API token", () => {
  describe("when the root widens its generic API type to an empty object", () => {
    /** @scenario "A provided client must implement the complete interface" */
    it("is accepted only while the implementation stays complete", () => {
      const consumer = createApp({ role: "api" }).withModules([licenseConsumerModule]);

      expect(consumer.provide({ licenseSource })).toBeDefined();
      expect(provideWidenedClient).toBeTypeOf("function");
    });
  });
});
