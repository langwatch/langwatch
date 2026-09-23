import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/application.ts";
import {
  DuplicateProviderError,
  FeatureApiUnavailableError,
  MissingProviderError,
} from "../src/boot-errors.ts";
import {
  defineServerModule,
  serverFeature,
  type FeatureSetup,
  type ServerRole,
} from "../src/feature-installer.ts";
import { LocalFeatureApis } from "../src/local-feature-api.ts";
import { moduleApi } from "../src/module-api-token.ts";
import { memberSourceOf } from "./member-source.ts";

interface ProjectApi {
  // Property-typed, not method shorthand: several tests below deliberately
  // extract this reference (`api.name`) before calling it, to prove a
  // not-yet-ready client throws on the extraction itself.
  name: () => Promise<string>;
  organizationName(): Promise<string>;
  echo(value: unknown): unknown;
  fail(error: Error): never;
}
const ProjectApi = moduleApi<ProjectApi>()("project");

interface OrganizationApi {
  // See ProjectApi.name above.
  name: () => Promise<string>;
  projectName(): Promise<string>;
}
const OrganizationApi = moduleApi<OrganizationApi>()("organization");

describe("process-owned feature references", () => {
  it("forwards through the bound app only after readiness", async () => {
    const apis = new LocalFeatureApis();
    apis.declare(OrganizationApi);
    const organizations = apis.reference(OrganizationApi);

    expect(() => organizations.name).toThrow(FeatureApiUnavailableError);
    apis.bind(OrganizationApi, {
      name: async () => "installed organization",
      projectName: async () => "installed project",
    });
    expect(() => organizations.name).toThrow(FeatureApiUnavailableError);

    apis.ready();
    await expect(organizations.name()).resolves.toBe("installed organization");
    const name = organizations.name;
    apis.close();
    expect(() => name()).toThrow(FeatureApiUnavailableError);
    expect(() => apis.ready()).toThrow("bindings are closed");
  });

  it("rejects missing and duplicate bindings", () => {
    const apis = new LocalFeatureApis();
    apis.declare(OrganizationApi);
    expect(() => apis.ready()).toThrow("has no implementation");
    expect(() => apis.declare(OrganizationApi)).toThrow("declared twice");

    const app: OrganizationApi = {
      name: async () => "organization",
      projectName: async () => "project",
    };
    apis.bind(OrganizationApi, app);
    expect(() => apis.bind(OrganizationApi, app)).toThrow("bound twice");
  });

  it("keeps every client in a nested chain gated by its own readiness", async () => {
    const inner = new LocalFeatureApis();
    const outer = new LocalFeatureApis();
    inner.declare(OrganizationApi);
    outer.declare(OrganizationApi);
    const app: OrganizationApi = {
      name: async () => "organization",
      projectName: async () => "project",
    };
    inner.bind(OrganizationApi, app);
    outer.bind(OrganizationApi, inner.reference(OrganizationApi));
    const api = outer.reference(OrganizationApi);

    expect(() => api.name).toThrow(FeatureApiUnavailableError);
    outer.ready();
    expect(() => api.name).toThrow(FeatureApiUnavailableError);
    inner.ready();
    const name = api.name;
    await expect(name()).resolves.toBe("organization");

    inner.close();
    expect(name).toThrow(FeatureApiUnavailableError);
    outer.close();
  });

  it("rejects direct and indirect client binding cycles before readiness", () => {
    const first = new LocalFeatureApis();
    const second = new LocalFeatureApis();
    const third = new LocalFeatureApis();
    for (const apis of [first, second, third]) apis.declare(OrganizationApi);

    expect(() => first.bind(OrganizationApi, first.reference(OrganizationApi))).toThrow(
      "cyclic client binding",
    );
    first.bind(OrganizationApi, second.reference(OrganizationApi));
    second.bind(OrganizationApi, third.reference(OrganizationApi));
    expect(() => third.bind(OrganizationApi, first.reference(OrganizationApi))).toThrow(
      "cyclic client binding",
    );

    third.bind(OrganizationApi, {
      name: async () => "organization",
      projectName: async () => "project",
    });
    for (const apis of [first, second, third]) apis.ready();
    for (const apis of [first, second, third]) apis.close();
  });

  it("does not invoke arbitrary proxy get traps as feature operations", () => {
    const apis = new LocalFeatureApis();
    apis.declare(OrganizationApi);
    const get = vi.fn(() => () => "untrusted");
    const app: OrganizationApi = {
      name: async () => "organization",
      projectName: async () => "project",
    };
    apis.bind(OrganizationApi, new Proxy(app, { get }));
    apis.ready();

    expect(() => Reflect.get(apis.reference(OrganizationApi), "hidden")).toThrow("operations only");
    expect(get).not.toHaveBeenCalled();
    apis.close();
  });
});

/**
 * The members these two modules read. Every one is always supplied, because a
 * module is handed exactly what it declared and boot refuses a name this
 * process cannot answer - which is the behaviour, not an inconvenience.
 */
interface DeclaredMembers {
  events: string[];
  inspectPeer: boolean;
  failOrganization: Error | null;
}

/** What one test states about the run, before the harness completes it. */
type Harness = Readonly<{
  events: string[];
  inspectPeer?: boolean;
  failOrganization?: Error;
}>;

class ProjectApp implements ProjectApi {
  static readonly contract = ProjectApi;
  static readonly dependencies = { organizations: OrganizationApi };
  static readonly reads = ["events", "inspectPeer", "failOrganization"] as const;
  readonly #label = "project";

  readonly #organizations: OrganizationApi;

  private constructor(organizations: OrganizationApi) {
    this.#organizations = organizations;
  }

  static create({
    dependencies,
    members,
    resources,
  }: FeatureSetup<typeof ProjectApp.dependencies, DeclaredMembers, undefined>) {
    members.events.push("create:project");
    resources.own("project", () => {
      members.events.push("close:project");
    });
    return new ProjectApp(dependencies.organizations);
  }

  async name(): Promise<string> {
    return this.#label;
  }
  organizationName(): Promise<string> {
    return this.#organizations.name();
  }
  echo(value: unknown): unknown {
    return value;
  }
  fail(error: Error): never {
    throw error;
  }
  get rawGetter(): never {
    throw new Error("raw getter evaluated");
  }
}

class OrganizationApp implements OrganizationApi {
  static readonly contract = OrganizationApi;
  static readonly dependencies = { projects: ProjectApi };
  static readonly reads = ["events", "inspectPeer", "failOrganization"] as const;
  readonly #projects: ProjectApi;

  private constructor(projects: ProjectApi) {
    this.#projects = projects;
  }

  static create({
    dependencies,
    members,
    resources,
  }: FeatureSetup<typeof OrganizationApp.dependencies, DeclaredMembers, undefined>) {
    members.events.push("create:organization");
    resources.own("organization", () => {
      members.events.push("close:organization");
    });
    if (members.inspectPeer) {
      Reflect.get(dependencies.projects, "name");
    }
    if (members.failOrganization) throw members.failOrganization;
    return new OrganizationApp(dependencies.projects);
  }

  async name(): Promise<string> {
    return "organization";
  }
  projectName(): Promise<string> {
    return this.#projects.name();
  }
}

const project = defineServerModule("project").withApp(ProjectApp).build();
const organization = defineServerModule("organization").withApp(OrganizationApp).build();

/** Every member these modules declared, so the process can answer all of them. */
function processMembers(harness: Harness = { events: [] }) {
  return memberSourceOf<DeclaredMembers>({
    events: harness.events,
    inspectPeer: harness.inspectPeer ?? false,
    failOrganization: harness.failOrganization ?? null,
  });
}

function graph(harness: Harness, reversed = false, role: ServerRole = "api") {
  const builder = createApp({ role, members: processMembers(harness) });
  return builder.withModules(reversed ? [organization, project] : [project, organization]);
}

describe("feature APIs", () => {
  it.each(["api", "worker"] satisfies ServerRole[])(
    "forwards an installed %s client through outer references without exposing its implementation",
    async (role) => {
      const runtime = await graph({ events: [] }, false, role).boot();
      const outer = new LocalFeatureApis();
      outer.declare(ProjectApi);
      outer.bind(ProjectApi, runtime.service(ProjectApi));
      outer.ready();
      const api = outer.reference(ProjectApi);
      const name = api.name;
      const value = { original: true };
      const failure = new Error("original failure");

      await expect(name()).resolves.toBe("project");
      await expect(api.organizationName()).resolves.toBe("organization");
      expect(api.echo(value)).toBe(value);
      expect(() => api.fail(failure)).toThrow(failure);
      expect(() => Reflect.get(api, "rawGetter")).toThrow("operations only");
      expect(() => Reflect.get(api, "valueOf")).toThrow("operations only");
      expect(Reflect.get(api, "constructor")).toBe(void 0);
      expect(Reflect.get(api, "then")).toBe(void 0);
      expect(() => Reflect.set(api, "name", () => "replacement")).toThrow("read-only");
      expect(api.name).toBe(name);

      outer.close();
      expect(name).toThrow(FeatureApiUnavailableError);
      await expect(runtime.service(ProjectApi).name()).resolves.toBe("project");
      await runtime.stop();
    },
  );

  it("rejects API providers through the legacy installer before construction", async () => {
    const events: string[] = [];
    const legacy = serverFeature("project")
      .withSetup(() => {
        events.push("constructed");
        return {
          name: async () => "project",
          organizationName: async () => "organization",
          echo: (value: unknown) => value,
          fail: (error: Error): never => {
            throw error;
          },
        };
      })
      .provides(ProjectApi)
      .build();
    await expect(
      createApp({ role: "api", members: memberSourceOf({}) })
        .withModules([legacy])
        .boot(),
    ).rejects.toThrow("defineServerModule().withApp()");
    expect(events).toEqual([]);
  });

  it.each(["api", "worker"] satisfies ServerRole[])(
    "binds mutual APIs once before returning the %s runtime",
    async (role) => {
      const events: string[] = [];
      const runtime = await graph({ events }, false, role).boot();
      const projects = runtime.service(ProjectApi);
      const organizations = runtime.service(OrganizationApi);

      expect(runtime.module(project).provided).toBe(projects);
      await expect(projects.organizationName()).resolves.toBe("organization");
      await expect(organizations.projectName()).resolves.toBe("project");
      expect(events).toEqual(["create:project", "create:organization"]);
      await runtime.stop();
      expect(events.slice(2)).toEqual(["close:organization", "close:project"]);
    },
  );

  it("does not depend on feature registration order", async () => {
    const events: string[] = [];
    const runtime = await graph({ events }, true).boot();
    await expect(runtime.service(OrganizationApi).projectName()).resolves.toBe("project");
    await runtime.stop();
    expect(events).toEqual([
      "create:organization",
      "create:project",
      "close:project",
      "close:organization",
    ]);
  });

  it("rejects constructor access even when that peer was constructed earlier", async () => {
    const events: string[] = [];
    await expect(graph({ events, inspectPeer: true }).boot()).rejects.toBeInstanceOf(
      FeatureApiUnavailableError,
    );
    expect(events).toEqual([
      "create:project",
      "create:organization",
      "close:organization",
      "close:project",
    ]);
  });

  it("preserves factory failures and unwinds partial construction", async () => {
    const events: string[] = [];
    const cause = new Error("organization failed");
    await expect(graph({ events, failOrganization: cause }, false, "worker").boot()).rejects.toBe(
      cause,
    );
    expect(events).toEqual([
      "create:project",
      "create:organization",
      "close:organization",
      "close:project",
    ]);
  });

  it("rejects a missing API before constructing anything", async () => {
    const events: string[] = [];
    await expect(
      createApp({ role: "api", members: processMembers({ events }) })
        .withModules([project])
        .boot(),
    ).rejects.toBeInstanceOf(MissingProviderError);
    expect(events).toEqual([]);
  });

  it("does not publish service-valued implementation fields", async () => {
    const runtime = await graph({ events: [] }).boot();
    expect(() => Reflect.get(runtime.service(ProjectApi), "organizations")).toThrow(
      "operations only",
    );
    expect(() => Reflect.set(runtime.service(ProjectApi), "organizations", {})).toThrow(
      "read-only",
    );
    await runtime.stop();
  });

  it("does not expose implementation objects or evaluate implementation getters", async () => {
    const runtime = await graph({ events: [] }).boot();
    const api = runtime.service(ProjectApi);

    expect(() => Reflect.get(api, "valueOf")).toThrow("operations only");
    expect(() => Reflect.get(api, "rawGetter")).toThrow("operations only");
    await runtime.stop();
  });

  it("preserves argument, result, error identity, and method this binding", async () => {
    const runtime = await graph({ events: [] }).boot();
    const api = runtime.service(ProjectApi);
    const value = { identity: true };
    const error = new Error("same error");

    expect(api.echo(value)).toBe(value);
    const promise = Promise.resolve(value);
    expect(api.echo(promise)).toBe(promise);
    await expect(api.name()).resolves.toBe("project");
    let caught: unknown;
    try {
      api.fail(error);
    } catch (failure) {
      caught = failure;
    }
    expect(caught).toBe(error);
    await runtime.stop();
  });

  it("closes retained API methods when the runtime stops", async () => {
    const runtime = await graph({ events: [] }).boot();
    const name = runtime.service(ProjectApi).name;
    await expect(name()).resolves.toBe("project");
    await runtime.stop();
    expect(name).toThrow(FeatureApiUnavailableError);
  });

  it("rejects two distinct token objects claiming the same feature identity", async () => {
    const builder = createApp({ role: "api", members: processMembers() }).withModules([
      project,
      defineServerModule("project").withApp(ProjectApp).build(),
    ]);
    await expect(builder.boot()).rejects.toBeInstanceOf(DuplicateProviderError);
  });

  describe("when the process supplies a capability by token", () => {
    interface ProjectGrant {
      grant(): string;
    }
    /**
     * A second token carrying an installed module's name, the way the core license source carries
     * the licensing module's.
     */
    const ProjectGrant = moduleApi<ProjectGrant>()("project");

    class GrantedOrganizationApp implements OrganizationApi {
      static readonly contract = OrganizationApi;
      static readonly dependencies = { projects: ProjectApi, grant: ProjectGrant };
      static readonly reads = ["events", "inspectPeer", "failOrganization"] as const;
      readonly #projects: ProjectApi;
      readonly #grant: ProjectGrant;

      private constructor(projects: ProjectApi, grant: ProjectGrant) {
        this.#projects = projects;
        this.#grant = grant;
      }

      static create({
        dependencies,
      }: FeatureSetup<typeof GrantedOrganizationApp.dependencies, DeclaredMembers, undefined>) {
        return new GrantedOrganizationApp(dependencies.projects, dependencies.grant);
      }

      async name(): Promise<string> {
        return this.#grant.grant();
      }
      projectName(): Promise<string> {
        return this.#projects.name();
      }
    }

    const grantedOrganization = defineServerModule("organization")
      .withApp(GrantedOrganizationApp)
      .build();

    /** @scenario "The process supplies a capability a module of that name does not answer for" */
    it("keeps the module's own API and the process's apart", async () => {
      const runtime = await createApp({ role: "api", members: processMembers() })
        .withModules([project, grantedOrganization])
        .withProvided(ProjectGrant, { grant: () => "granted" })
        .boot();

      await expect(runtime.service(ProjectApi).name()).resolves.toBe("project");
      await expect(runtime.service(OrganizationApi).name()).resolves.toBe("granted");
      await runtime.stop();
    });

    /** @scenario "A module cannot answer for a capability the process already supplied" */
    it("refuses a module answering for the very token the process handed over", async () => {
      await expect(
        createApp({ role: "api", members: processMembers() })
          .withModules([project, organization])
          .withProvided(ProjectApi, {
            name: async () => "provided",
            organizationName: async () => "provided",
            echo: (value: unknown) => value,
            fail: (error: Error): never => {
              throw error;
            },
          })
          .boot(),
      ).rejects.toBeInstanceOf(DuplicateProviderError);
    });
  });

  it("rejects a declaration/API name mismatch before invoking the factory", async () => {
    const events: string[] = [];
    const declaration = defineServerModule("organization").withApp(ProjectApp).build();

    await expect(
      createApp({ role: "api", members: processMembers({ events }) })
        .withModules([declaration])
        .boot(),
    ).rejects.toThrow('cannot provide API "project"');
    expect(events).toEqual([]);
  });

  it("invalidates retained APIs after a start failure", async () => {
    const startFailure = new Error("start failed");
    const runtime = await graph({ events: [] })
      .withService({
        name: "failing-start",
        start: () => Promise.reject(startFailure),
        stop: () => undefined,
      })
      .boot();
    const api = runtime.service(ProjectApi);

    await expect(runtime.start()).rejects.toBe(startFailure);
    expect(() => api.name()).toThrow(FeatureApiUnavailableError);
  });

  it("invalidates retained APIs after cleanup failure", async () => {
    const cleanupFailure = new Error("cleanup failed");
    const runtime = await graph({ events: [] })
      .withService({
        name: "failing-stop",
        start: () => undefined,
        stop: () => Promise.reject(cleanupFailure),
      })
      .boot();
    const api = runtime.service(ProjectApi);

    await runtime.start();
    await expect(runtime.stop()).rejects.toMatchObject({
      name: "AggregateError",
      errors: expect.any(Array),
    });
    expect(() => api.name()).toThrow(FeatureApiUnavailableError);
  });
});
