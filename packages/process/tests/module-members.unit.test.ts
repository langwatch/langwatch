import { moduleApi } from "@langwatch/module";
/**
 * How a peer arrives: handed in by the process, or provided by an installed module.
 * Spec: packages/process/specs/module-members.feature
 */
import { describe, expect, it } from "vitest";

import { ApplicationBuilder } from "../src/application.ts";
import { DuplicateProviderError } from "../src/boot-errors.ts";
import { defineProcessModule, type FeatureSetup } from "../src/feature-installer.ts";
import { testPeer } from "../src/testing.ts";
import { memberSourceOf } from "./member-source.ts";

interface ProjectApi {
  name(): string;
}
const ProjectApi = moduleApi<ProjectApi>()("project");

interface AnnotationApi {
  stamp(): string;
}
const AnnotationApi = moduleApi<AnnotationApi>()("annotation");

class AnnotationModule implements AnnotationApi {
  static readonly contract = AnnotationApi;
  static readonly dependencies = { projects: ProjectApi };

  private constructor(private readonly projects: ProjectApi) {}

  static create(
    setup: FeatureSetup<typeof AnnotationModule.dependencies, undefined>,
  ): AnnotationModule {
    return new AnnotationModule(setup.dependencies.projects);
  }

  stamp(): string {
    return `${this.projects.name()}@noon`;
  }
}

const annotation = defineProcessModule("annotation").withApi(AnnotationModule).build();

const projects: ProjectApi = { name: () => "project" };

describe("given a peer the process answers for itself", () => {
  describe("when a module depends on that peer", () => {
    /** @scenario "A process hands a module one peer by its token" */
    it("resolves the instance the caller handed in, unwrapped", async () => {
      const runtime = await new ApplicationBuilder({
        role: "api",
        stores: memberSourceOf({}),
        peers: [testPeer({ token: ProjectApi, instance: projects })],
      })
        .withModules([annotation])
        .boot();

      expect(runtime.service(AnnotationApi).stamp()).toBe("project@noon");
      expect(runtime.service(ProjectApi)).toBe(projects);
      await runtime.stop();
    });
  });

  describe("when the same token is handed in twice", () => {
    it("refuses while building, naming the token", () => {
      const peer = testPeer({ token: ProjectApi, instance: projects });
      const build = () =>
        new ApplicationBuilder({
          role: "api",
          stores: memberSourceOf({}),
          peers: [peer, peer],
        });

      expect(build).toThrow(DuplicateProviderError);
    });
  });

  describe("when a module installed beside it provides the same token", () => {
    /** @scenario "A peer handed in and a module that provides it" */
    it("refuses to boot rather than choosing one", async () => {
      const booting = new ApplicationBuilder({
        role: "api",
        stores: memberSourceOf({}),
        peers: [
          testPeer({ token: ProjectApi, instance: projects }),
          testPeer({ token: AnnotationApi, instance: { stamp: () => "handed" } }),
        ],
      })
        .withModules([annotation])
        .boot();

      await expect(booting).rejects.toBeInstanceOf(DuplicateProviderError);
    });
  });
});
