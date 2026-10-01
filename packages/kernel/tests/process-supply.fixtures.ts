import { Config } from "@langwatch/config";
import { z } from "zod";

import {
  defineServerModule,
  type FeatureSetup,
  withMemoryRepositories,
} from "../src/feature-installer.ts";
import { moduleApi } from "../src/module-api-token.ts";
import { defineRepositories } from "../src/repository-registry.ts";
import { supplyToken } from "../src/supply-token.ts";

export interface ProjectApi {
  getById(id: string): string;
}
export const ProjectApi = moduleApi<ProjectApi>()("project");
class ProjectApp implements ProjectApi {
  static readonly contract = ProjectApi;
  static readonly dependencies = {};
  static create(_setup?: Readonly<{ config: undefined }>): ProjectApp {
    return new ProjectApp();
  }
  getById(id: string): string {
    return `project:${id}`;
  }
}
export const projectModule = defineServerModule("project").withApp(ProjectApp).build();
export const project = ProjectApp.create();

interface ClockApi {
  now(): string;
}
const ClockApi = moduleApi<ClockApi>()("annotation");
export class ClockApp implements ClockApi {
  static readonly contract = ClockApi;
  static readonly dependencies = {};
  static readonly reads = ["clock"] as const;
  readonly #clock: () => string;
  private constructor(clock: () => string) {
    this.#clock = clock;
  }
  static create({
    members,
  }: FeatureSetup<
    Record<never, never>,
    { clock: () => string; unused?: number },
    undefined
  >): ClockApp {
    return new ClockApp(members.clock);
  }
  now(): string {
    return this.#clock();
  }
}
export const clockModule = defineServerModule("annotation").withApp(ClockApp).build();
export const clock = () => "frozen";

interface ConfigApi {
  pepper(): string;
}
const ConfigApi = moduleApi<ConfigApi>()("api-key");
class ConfigApp implements ConfigApi {
  static readonly contract = ConfigApi;
  static readonly dependencies = {};
  static readonly config = Config.define((c) => ({ pepper: c.env("API_KEY_PEPPER", z.string()) }));
  readonly #pepper: string;
  private constructor(pepper: string) {
    this.#pepper = pepper;
  }
  static create({
    config,
  }: FeatureSetup<Record<never, never>, Record<never, never>, { pepper: string }>): ConfigApp {
    return new ConfigApp(config.pepper);
  }
  pepper(): string {
    return this.#pepper;
  }
}
export const configModule = defineServerModule("api-key").withApp(ConfigApp).build();

interface PeerApi {
  read(id: string): string;
}
const PeerApi = moduleApi<PeerApi>()("audit-log");
class PeerApp implements PeerApi {
  static readonly contract = PeerApi;
  static readonly dependencies = { projects: ProjectApi };
  readonly #projects: ProjectApi;
  private constructor(projects: ProjectApi) {
    this.#projects = projects;
  }
  static create({
    dependencies,
  }: FeatureSetup<typeof PeerApp.dependencies, Record<never, never>, undefined>): PeerApp {
    return new PeerApp(dependencies.projects);
  }
  read(id: string): string {
    return this.#projects.getById(id);
  }
}
export const peerModule = defineServerModule("audit-log").withApp(PeerApp).build();

type Facilities = {
  relational: { query(): string };
  keyvalue: { get(key: string): string };
  clock: () => string;
  logging: { info(message: string): void };
  metrics: { count(name: string): void };
  tracing: { span(name: string): void };
  secrets: { read(name: string): string };
  encryption: { encrypt(value: string): string };
};
interface FacilityApi {
  read(): string;
}
const FacilityApi = moduleApi<FacilityApi>()("user");
class FacilityApp implements FacilityApi {
  static readonly contract = FacilityApi;
  static readonly dependencies = {};
  static readonly reads = [
    "relational",
    "keyvalue",
    "clock",
    "logging",
    "metrics",
    "tracing",
    "secrets",
    "encryption",
  ] as const;
  readonly #members: Facilities;
  private constructor(members: Facilities) {
    this.#members = members;
  }
  static create({
    members,
  }: FeatureSetup<Record<never, never>, Facilities, undefined>): FacilityApp {
    return new FacilityApp(members);
  }
  read(): string {
    return this.#members.relational.query();
  }
}
export const facilityModule = defineServerModule("user").withApp(FacilityApp).build();
export const facilities: Facilities = {
  relational: { query: () => "rows" },
  keyvalue: { get: (key) => key },
  clock,
  logging: {
    info: (message) => {
      messages.push(message);
    },
  },
  metrics: {
    count: (name) => {
      messages.push(name);
    },
  },
  tracing: {
    span: (name) => {
      messages.push(name);
    },
  },
  secrets: { read: (name) => name },
  encryption: { encrypt: (value) => `encrypted:${value}` },
};
const messages: string[] = [];

export class RelationalRepositories {
  static readonly requires = ["relational"] as const;
  static create({ relational }: { relational: Facilities["relational"] }) {
    return { row: () => relational.query() };
  }
}
export class MemoryRepositories {
  static readonly requires = [] as const;
  static create() {
    return { row: () => "memory" };
  }
}

const repositories = defineRepositories({
  live: RelationalRepositories,
  memory: MemoryRepositories,
});
interface RepositoryApi {
  row(): string;
}
const RepositoryApi = moduleApi<RepositoryApi>()("dataset");
class RepositoryApp implements RepositoryApi {
  static readonly contract = RepositoryApi;
  static readonly dependencies = {};
  static readonly reads = ["clock"] as const;
  readonly #row: () => string;
  private constructor(row: () => string) {
    this.#row = row;
  }
  static create({
    repositories,
    members,
  }: FeatureSetup<
    Record<never, never>,
    { clock: () => string; unused?: string },
    undefined,
    { row(): string }
  >): RepositoryApp {
    return new RepositoryApp(() => `${repositories.row()}@${members.clock()}`);
  }
  row(): string {
    return this.#row();
  }
}
export const repositoryModule = defineServerModule("dataset")
  .withRepositories(repositories)
  .withApp(RepositoryApp)
  .build();
export const memoryRepositoryModule = withMemoryRepositories(repositoryModule);

export interface Connections {
  primary(): string;
}
interface ConnectionsApi {
  primary(): string;
}
const ConnectionsApi = moduleApi<ConnectionsApi>()("sso");
class ConnectionsApp implements ConnectionsApi {
  static readonly contract = ConnectionsApi;
  static readonly dependencies = {};
  static readonly reads = ["connections"] as const;
  private constructor(private readonly connections: Connections) {}
  static create({ members }: FeatureSetup<{}, { connections: Connections }, undefined>) {
    return new ConnectionsApp(members.connections);
  }
  primary(): string {
    return this.connections.primary();
  }
}
export const connections = { primary: () => "primary" } satisfies Connections;
export const connectionsModule = defineServerModule("sso").withApp(ConnectionsApp).build();

interface LicenseSource {
  resolve(): string;
}
export const LicenseSource = supplyToken<LicenseSource>()("licenseSource");
interface LicenseConsumerApi {
  plan(): string;
}
const LicenseConsumerApi = moduleApi<LicenseConsumerApi>()("entitlement");
class LicenseConsumerApp implements LicenseConsumerApi {
  static readonly contract = LicenseConsumerApi;
  static readonly dependencies = { license: LicenseSource };
  private constructor(private readonly source: LicenseSource) {}
  static create({
    dependencies,
  }: FeatureSetup<typeof LicenseConsumerApp.dependencies, {}, undefined>) {
    return new LicenseConsumerApp(dependencies.license);
  }
  plan(): string {
    return this.source.resolve();
  }
}
export const licenseSource = { resolve: () => "pro" } satisfies LicenseSource;
export const licenseConsumerModule = defineServerModule("entitlement")
  .withApp(LicenseConsumerApp)
  .build();
