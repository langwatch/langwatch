/**
 * What a process builds, what each module is handed, and how a peer arrives.
 * Spec: specs/server/declarative-process-composition.feature
 */
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/application.ts";
import { DuplicateProviderError } from "../src/boot-errors.ts";
import { defineServerModule, type FeatureSetup } from "../src/feature-installer.ts";
import { MissingMemberError } from "../src/module-members.ts";
import { moduleApi } from "../src/module-api-token.ts";
import type { MemberSource } from "../src/module-members.ts";

interface ProjectApi {
  name(): string;
}
const ProjectApi = moduleApi<ProjectApi>("project");

interface AnnotationApi {
  stamp(): string;
}
const AnnotationApi = moduleApi<AnnotationApi>("annotation");

type Members = Readonly<{ clock: () => string; mail: { sent: string[] }; unread: string }>;

class AnnotationApp implements AnnotationApi {
  static readonly contract = AnnotationApi;
  static readonly dependencies = { projects: ProjectApi };
  static readonly reads = ["clock"] as const;

  private constructor(
    private readonly clock: () => string,
    private readonly projects: ProjectApi,
  ) {}

  static create(
    setup: FeatureSetup<typeof AnnotationApp.dependencies, Members, undefined>,
  ): AnnotationApp {
    handed = setup.members as Readonly<Record<string, unknown>>;
    return new AnnotationApp(setup.members.clock, setup.dependencies.projects);
  }

  stamp(): string {
    return `${this.projects.name()}@${this.clock()}`;
  }
}

/** What the app was handed, read back outside its API reference. */
let handed: Readonly<Record<string, unknown>> = {};

const annotation = defineServerModule("annotation").withApp(AnnotationApp).build();

/** A source that records which members were asked for, and in which order. */
function recordingSource(
  members: Partial<Members>,
  asked: string[],
): MemberSource<Members> {
  const order = ["clock", "mail", "unread"] as (keyof Members & string)[];
  return {
    order,
    read<Name extends keyof Members & string>(name: Name): Members[Name] {
      asked.push(name);
      const value = members[name];
      if (value === void 0) throw new Error(`This process has no "${name}" member.`);
      return value as Members[Name];
    },
    close: () => Promise.resolve(),
  };
}

const projects: ProjectApi = { name: () => "project" };

describe("given a process whose modules declare what they read", () => {
  describe("when it boots", () => {
    /** @scenario "Boot builds exactly the members the installed modules declared" */
    it("builds only the declared union and asks for nothing else", async () => {
      const asked: string[] = [];
      const runtime = await createApp({
        role: "api",
        members: recordingSource({ clock: () => "now", mail: { sent: [] }, unread: "x" }, asked),
      })
        .withProvided(ProjectApi, projects)
        .withModules([annotation])
        .boot();

      expect(asked).toEqual(["clock"]);
      expect(runtime.members).toEqual({ clock: expect.any(Function) });
      await runtime.stop();
    });

    it("hands one module the members it named and nothing else", async () => {
      const runtime = await createApp({
        role: "api",
        members: recordingSource({ clock: () => "now", mail: { sent: [] }, unread: "x" }, []),
      })
        .withProvided(ProjectApi, projects)
        .withModules([annotation])
        .boot();

      expect(Object.keys(handed)).toEqual(["clock"]);
      await runtime.stop();
    });
  });

  describe("when this process cannot supply a member a module declared", () => {
    /** @scenario "A member an installed module names that this process cannot supply" */
    it("refuses before serving, naming the module and the member", async () => {
      const create = vi.spyOn(AnnotationApp, "create");
      const booting = createApp({ role: "api", members: recordingSource({}, []) })
        .withProvided(ProjectApi, projects)
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
      const runtime = await createApp({
        role: "api",
        members: recordingSource({ clock: () => "noon" }, []),
      })
        .withProvided(ProjectApi, projects)
        .withModules([annotation])
        .boot();

      expect(runtime.service(AnnotationApi).stamp()).toBe("project@noon");
      expect(runtime.service(ProjectApi)).toBe(projects);
      await runtime.stop();
    });
  });

  describe("when the same token is handed in twice", () => {
    it("refuses at the second call, naming the token", () => {
      const builder = createApp({
        role: "api",
        members: recordingSource({ clock: () => "noon" }, []),
      }).withProvided(ProjectApi, projects);

      expect(() => builder.withProvided(ProjectApi, projects)).toThrow(DuplicateProviderError);
    });
  });

  describe("when a module installed beside it provides the same token", () => {
    /** @scenario "A peer handed in and a module that provides it" */
    it("refuses to boot rather than choosing one", async () => {
      const booting = createApp({
        role: "api",
        members: recordingSource({ clock: () => "noon" }, []),
      })
        .withProvided(ProjectApi, projects)
        .withProvided(AnnotationApi, { stamp: () => "handed" })
        .withModules([annotation])
        .boot();

      await expect(booting).rejects.toBeInstanceOf(DuplicateProviderError);
    });
  });
});
