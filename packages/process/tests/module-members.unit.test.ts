import { moduleApi } from "@langwatch/module";
import type { StoresMemberSource } from "@langwatch/process-stores";
/**
 * What a process builds, what each module is handed, and how a peer arrives.
 * Spec: specs/server/declarative-process-composition.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ApplicationBuilder } from "../src/application.ts";
import { DuplicateProviderError } from "../src/boot-errors.ts";
import { defineProcessModule, type FeatureSetup } from "../src/feature-installer.ts";
import { MissingMemberError } from "../src/module-members.ts";
import { testPeer } from "../src/testing.ts";

interface ProjectApi {
  name(): string;
}
const ProjectApi = moduleApi<ProjectApi>()("project");

interface AnnotationApi {
  stamp(): string;
}
const AnnotationApi = moduleApi<AnnotationApi>()("annotation");

type Members = Readonly<{ clock: () => string; mail: { sent: string[] }; unread: string }>;

class AnnotationModule implements AnnotationApi {
  static readonly contract = AnnotationApi;
  static readonly dependencies = { projects: ProjectApi };
  static readonly reads = ["clock"] as const;

  private constructor(
    private readonly clock: () => string,
    private readonly projects: ProjectApi,
  ) {}

  static create(
    setup: FeatureSetup<typeof AnnotationModule.dependencies, undefined> &
      Readonly<{ members: Members }>,
  ): AnnotationModule {
    handed = setup.members as Readonly<Record<string, unknown>>;
    return new AnnotationModule(setup.members.clock, setup.dependencies.projects);
  }

  stamp(): string {
    return `${this.projects.name()}@${this.clock()}`;
  }
}

/** What the app was handed, read back outside its API reference. */
let handed: Readonly<Record<string, unknown>> = {};

const annotation = defineProcessModule("annotation").withApi(AnnotationModule).build();

/** A source that records which members were asked for, and in which order. */
function recordingSource(members: Partial<Members>, asked: string[]): StoresMemberSource {
  const values: Readonly<Record<string, unknown>> = members;
  return {
    order: ["clock", "mail", "unread"],
    read(name: string): unknown {
      asked.push(name);
      const value = values[name];
      if (value === void 0) throw new Error(`This process has no "${name}" member.`);
      return value;
    },
  };
}

const projects: ProjectApi = { name: () => "project" };

describe("given a process whose modules declare what they read", () => {
  describe("when it boots", () => {
    /** @scenario "A module names the pool members it reads" */
    it("builds only the declared union and asks for nothing else", async () => {
      const asked: string[] = [];
      const runtime = await new ApplicationBuilder({
        role: "api",
        stores: recordingSource({ clock: () => "now", mail: { sent: [] }, unread: "x" }, asked),
        peers: [testPeer({ token: ProjectApi, instance: projects })],
      })
        .withModules([annotation])
        .boot();

      expect(asked).toEqual(["clock"]);
      expect(runtime.members).toEqual({ clock: expect.any(Function) });
      await runtime.stop();
    });

    /** @scenario "A module names the pool members it reads" */
    it("hands one module the members it named and nothing else", async () => {
      const runtime = await new ApplicationBuilder({
        role: "api",
        stores: recordingSource({ clock: () => "now", mail: { sent: [] }, unread: "x" }, []),
        peers: [testPeer({ token: ProjectApi, instance: projects })],
      })
        .withModules([annotation])
        .boot();

      expect(Object.keys(handed)).toEqual(["clock"]);
      await runtime.stop();
    });
  });

  describe("when this process cannot supply a member a module declared", () => {
    /** @scenario "A pool member the module named is absent at boot" */
    it("refuses before serving, naming the module and the member", async () => {
      const create = vi.spyOn(AnnotationModule, "create");
      const booting = new ApplicationBuilder({
        role: "api",
        stores: recordingSource({}, []),
        peers: [testPeer({ token: ProjectApi, instance: projects })],
      })
        .withModules([annotation])
        .boot();

      await expect(booting).rejects.toBeInstanceOf(MissingMemberError);
      await expect(booting).rejects.toMatchObject({ module: "annotation", member: "clock" });
      expect(create).not.toHaveBeenCalled();
      create.mockRestore();
    });
  });
});

describe("given a peer the process answers for itself", () => {
  describe("when a module depends on that peer", () => {
    /** @scenario "A process hands a module one peer by its token" */
    it("resolves the instance the caller handed in, unwrapped", async () => {
      const runtime = await new ApplicationBuilder({
        role: "api",
        stores: recordingSource({ clock: () => "noon" }, []),
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
          stores: recordingSource({ clock: () => "noon" }, []),
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
        stores: recordingSource({ clock: () => "noon" }, []),
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
