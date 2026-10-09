import { Config } from "@langwatch/config";
import { moduleApi } from "@langwatch/module";
import { z } from "zod";

import { type BoundApis, defineChannels } from "../src/channel-registry.ts";
import { defineProcessModule, type FeatureSetup } from "../src/feature-installer.ts";
import { defineRepositories } from "../src/repository-registry.ts";

export interface ProjectApi {
  getById(id: string): string;
}
export const ProjectApi = moduleApi<ProjectApi>()("project");
class ProjectModule implements ProjectApi {
  static readonly contract = ProjectApi;
  static readonly dependencies = {};
  static create(_setup?: Readonly<{ config: undefined }>): ProjectModule {
    return new ProjectModule();
  }
  getById(id: string): string {
    return `project:${id}`;
  }
}
export const projectModule = defineProcessModule("project").withApi(ProjectModule).build();
export const project = ProjectModule.create();

interface ClockApi {
  now(): string;
}
const ClockApi = moduleApi<ClockApi>()("annotation");
type ClockClients = { clock: () => string };
/** Store clients reach a module only through its registry; this one hands over the clock. */
class ClockRepositories {
  static readonly requires = ["clock"] as const;
  static create(clients: ClockClients): ClockClients {
    return clients;
  }
}
export class ClockApp implements ClockApi {
  static readonly contract = ClockApi;
  static readonly dependencies = {};
  readonly #clock: () => string;
  private constructor(clock: () => string) {
    this.#clock = clock;
  }
  static create({
    repositories,
  }: FeatureSetup<Record<never, never>, undefined, ClockClients>): ClockApp {
    return new ClockApp(repositories.clock);
  }
  now(): string {
    return this.#clock();
  }
}
export const clockRepositories = defineRepositories({
  live: ClockRepositories,
  memory: ClockRepositories,
});
export const clockModule = defineProcessModule("annotation")
  .withRepositories(clockRepositories)
  .withApi(ClockApp)
  .build();
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
  static create({ config }: FeatureSetup<Record<never, never>, { pepper: string }>): ConfigApp {
    return new ConfigApp(config.pepper);
  }
  pepper(): string {
    return this.#pepper;
  }
}
export const configModule = defineProcessModule("api-key").withApi(ConfigApp).build();

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
  static create({ dependencies }: FeatureSetup<typeof PeerApp.dependencies, undefined>): PeerApp {
    return new PeerApp(dependencies.projects);
  }
  read(id: string): string {
    return this.#projects.getById(id);
  }
}
export const peerModule = defineProcessModule("audit-log").withApi(PeerApp).build();

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
class FacilityRepositories {
  static readonly requires = [
    "relational",
    "keyvalue",
    "clock",
    "logging",
    "metrics",
    "tracing",
    "secrets",
    "encryption",
  ] as const;
  static create(clients: {
    relational: Facilities["relational"];
    keyvalue: Facilities["keyvalue"];
    clock: Facilities["clock"];
    logging: Facilities["logging"];
    metrics: Facilities["metrics"];
    tracing: Facilities["tracing"];
    secrets: Facilities["secrets"];
    encryption: Facilities["encryption"];
  }): Facilities {
    return clients;
  }
}
class FacilityApp implements FacilityApi {
  static readonly contract = FacilityApi;
  static readonly dependencies = {};
  readonly #clients: Facilities;
  private constructor(clients: Facilities) {
    this.#clients = clients;
  }
  static create({
    repositories,
  }: FeatureSetup<Record<never, never>, undefined, Facilities>): FacilityApp {
    return new FacilityApp(repositories);
  }
  read(): string {
    return this.#clients.relational.query();
  }
}
export const facilityModule = defineProcessModule("user")
  .withRepositories(
    defineRepositories({ live: FacilityRepositories, memory: FacilityRepositories }),
  )
  .withApi(FacilityApp)
  .build();
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
  static readonly requires = ["relational", "clock"] as const;
  static create({
    relational,
    clock,
  }: {
    relational: Facilities["relational"];
    clock: () => string;
  }) {
    return { row: () => relational.query(), clock };
  }
}
export class MemoryRepositories {
  static readonly requires = ["clock"] as const;
  static create({ clock }: { clock: () => string }) {
    return { row: () => "memory", clock };
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
  readonly #row: () => string;
  private constructor(row: () => string) {
    this.#row = row;
  }
  static create({
    repositories,
  }: FeatureSetup<
    Record<never, never>,
    undefined,
    { row(): string; clock: () => string }
  >): RepositoryApp {
    return new RepositoryApp(() => `${repositories.row()}@${repositories.clock()}`);
  }
  row(): string {
    return this.#row();
  }
}
export const repositoryModule = defineProcessModule("dataset")
  .withRepositories(repositories)
  .withApi(RepositoryApp)
  .build();
/** The same module asking for its own memory registry, as a dev harness may (record §4). */
export const memoryRepositoryModule = Object.freeze({
  ...repositoryModule,
  tier: "memory" as const,
});

export interface Connections {
  primary(): string;
}
interface ConnectionsApi {
  primary(): string;
}
const ConnectionsApi = moduleApi<ConnectionsApi>()("sso");
class ConnectionsRepositories {
  static readonly requires = ["connections"] as const;
  static create(clients: { connections: Connections }) {
    return clients;
  }
}
class ConnectionsApp implements ConnectionsApi {
  static readonly contract = ConnectionsApi;
  static readonly dependencies = {};
  private constructor(private readonly connections: Connections) {}
  static create({ repositories }: FeatureSetup<{}, undefined, { connections: Connections }>) {
    return new ConnectionsApp(repositories.connections);
  }
  primary(): string {
    return this.connections.primary();
  }
}
export const connections = { primary: () => "primary" } satisfies Connections;
export const connectionsModule = defineProcessModule("sso")
  .withRepositories(
    defineRepositories({ live: ConnectionsRepositories, memory: ConnectionsRepositories }),
  )
  .withApi(ConnectionsApp)
  .build();

interface LicenseSource {
  resolve(): string;
}
export const LicenseSource = moduleApi<LicenseSource>()("licensing");
interface LicenseConsumerApi {
  plan(): string;
}
const LicenseConsumerApi = moduleApi<LicenseConsumerApi>()("entitlement");
class LicenseConsumerApp implements LicenseConsumerApi {
  static readonly contract = LicenseConsumerApi;
  static readonly dependencies = { license: LicenseSource };
  private constructor(private readonly source: LicenseSource) {}
  static create({ dependencies }: FeatureSetup<typeof LicenseConsumerApp.dependencies, undefined>) {
    return new LicenseConsumerApp(dependencies.license);
  }
  plan(): string {
    return this.source.resolve();
  }
}
export const licenseSource = { resolve: () => "pro" } satisfies LicenseSource;
export const licenseConsumerModule = defineProcessModule("entitlement")
  .withApi(LicenseConsumerApp)
  .build();

export interface VerdictApi {
  judge(text: string): string;
}
export const VerdictApi = moduleApi<VerdictApi>()("instant-eval");

interface VerdictChannels {
  readonly verdicts: Pick<VerdictApi, "judge">;
}

/** Binds the judge's Api without listing it as a dependency: only a stand-in can fill it. */
class BoundVerdictChannels {
  static readonly requires = [] as const;
  static readonly binds = { verdicts: VerdictApi } as const;

  static create({
    bound,
  }: {
    bound: BoundApis<typeof BoundVerdictChannels.binds>;
  }): VerdictChannels {
    return { verdicts: { judge: (text) => bound.verdicts.judge(text) } };
  }
}

export interface ScoringApi {
  score(text: string): string;
}
export const ScoringApi = moduleApi<ScoringApi>()("analytics");

class ScoringApp implements ScoringApi {
  static readonly contract = ScoringApi;
  static readonly dependencies = {};

  static create({
    channels,
  }: FeatureSetup<Record<never, never>, undefined, never, VerdictChannels>): ScoringApp {
    return new ScoringApp(channels.verdicts);
  }

  private constructor(private readonly verdicts: VerdictChannels["verdicts"]) {}

  score(text: string): string {
    return `scored ${this.verdicts.judge(text)}`;
  }
}

export const scoringModule = defineProcessModule("analytics")
  .withChannels(defineChannels({ live: BoundVerdictChannels, memory: BoundVerdictChannels }))
  .withApi(ScoringApp)
  .build();

/** The judge's own module: installing it satisfies the binding without a stand-in. */
class VerdictApp implements VerdictApi {
  static readonly contract = VerdictApi;
  static readonly dependencies = {};
  static create(_setup?: Readonly<{ config: undefined }>): VerdictApp {
    return new VerdictApp();
  }
  judge(text: string): string {
    return `judged ${text}`;
  }
}
export const verdictModule = defineProcessModule("instant-eval").withApi(VerdictApp).build();
export const verdicts: VerdictApi = VerdictApp.create();
