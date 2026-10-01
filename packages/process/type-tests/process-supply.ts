/* oxlint-disable import/namespace -- Negative probes intentionally access unexported names. */
import { expectTypeOf } from "vitest";

import { defineServerModule } from "../src/feature-installer.ts";
import * as packageEntry from "../src/index.ts";
import * as supplyEntry from "../src/process-supply.ts";
import { createApp, ProcessSupply } from "../src/process-supply.ts";
import type { SupplyModule } from "../src/process-supply.types.ts";
import {
  clock,
  clockModule,
  ClockApp,
  connections,
  connectionsModule,
  configModule,
  facilities,
  facilityModule,
  licenseConsumerModule,
  licenseSource,
  memoryRepositoryModule,
  peerModule,
  project,
  projectModule,
  repositoryModule,
  type ProjectApi,
} from "../tests/process-supply.fixtures.ts";

type MissingNames<Supply> =
  Supply extends ProcessSupply<
    infer _Modules,
    infer _Members,
    infer _Config,
    infer _Peers,
    infer Names
  >
    ? Names
    : never;

const minimal = createApp({ role: "api" }).withModules([clockModule]);
expectTypeOf<MissingNames<typeof minimal>>().toEqualTypeOf<"clock">();
// @ts-expect-error an outstanding clock refuses boot
void minimal.boot();
const suppliedClock = minimal.withClock(clock);
expectTypeOf<MissingNames<typeof suppliedClock>>().toEqualTypeOf<never>();
expectTypeOf<Parameters<typeof suppliedClock.boot>>().toEqualTypeOf<[]>();

const suppliedFirst = createApp({ role: "worker" }).withClock(clock).withModules([clockModule]);
expectTypeOf<MissingNames<typeof suppliedFirst>>().toEqualTypeOf<never>();
const missingConfig = suppliedClock.withModules([configModule]);
expectTypeOf<MissingNames<typeof missingConfig>>().toEqualTypeOf<"config.api-key">();
// @ts-expect-error an outstanding config slice refuses boot
void missingConfig.boot();
const configured = missingConfig.withConfig({ "api-key": { pepper: "test" } });
expectTypeOf<MissingNames<typeof configured>>().toEqualTypeOf<never>();
const noModules = createApp({ role: "api" });
expectTypeOf<MissingNames<typeof noModules>>().toEqualTypeOf<never>();

const missingPeer = createApp({ role: "api" }).withModules([peerModule]);
expectTypeOf<MissingNames<typeof missingPeer>>().toEqualTypeOf<"peer.project">();
// @ts-expect-error an outstanding peer refuses boot
void missingPeer.boot();
const installedLater = missingPeer.withModules([projectModule]);
expectTypeOf<MissingNames<typeof installedLater>>().toEqualTypeOf<never>();
const providedEarlier = createApp({ role: "api" }).provide({ project }).withModules([peerModule]);
expectTypeOf<MissingNames<typeof providedEarlier>>().toEqualTypeOf<never>();
const wrongEarlier = createApp({ role: "api" })
  .provide({ project: { other: () => "wrong" } })
  .withModules([peerModule]);
expectTypeOf<MissingNames<typeof wrongEarlier>>().toEqualTypeOf<"peer.project">();

const all = createApp({ role: "api" }).withModules([facilityModule, configModule, peerModule]);
expectTypeOf<MissingNames<typeof all>>().toEqualTypeOf<
  | "relational"
  | "keyvalue"
  | "clock"
  | "logging"
  | "metrics"
  | "tracing"
  | "secrets"
  | "encryption"
  | "config.api-key"
  | "peer.project"
>();
// @ts-expect-error every outstanding requirement refuses one boot
void all.boot();
const ready = all
  .withConfig({ "api-key": { pepper: "test" } })
  .provide({ project })
  .withRelational(facilities.relational)
  .withKeyvalue(facilities.keyvalue)
  .withClock(clock)
  .withSecrets(facilities.secrets)
  .withEncryption(facilities.encryption)
  .withObservability((o) =>
    o
      .withLogging(facilities.logging)
      .withTracing(facilities.tracing)
      .withMetrics(facilities.metrics),
  )
  .expose(() => ({ hosts: {}, serve: () => void 0 }));
expectTypeOf<MissingNames<typeof ready>>().toEqualTypeOf<never>();
void (() => ready.boot());
const wrongFacility = minimal.withObservability((o) => o.withMetrics(facilities.metrics));
expectTypeOf<MissingNames<typeof wrongFacility>>().toEqualTypeOf<"clock">();
// @ts-expect-error an unrelated facility does not satisfy the clock
void wrongFacility.boot();

const repositoryOnly = createApp({ role: "api" }).withModules([repositoryModule]);
expectTypeOf<MissingNames<typeof repositoryOnly>>().toEqualTypeOf<"relational" | "clock">();
const repositorySupplied = repositoryOnly.withRelational(facilities.relational).withClock(clock);
expectTypeOf<MissingNames<typeof repositorySupplied>>().toEqualTypeOf<never>();
void (() => repositorySupplied.boot());
const memoryRepositoryOnly = createApp({ role: "api" }).withModules([memoryRepositoryModule]);
expectTypeOf<MissingNames<typeof memoryRepositoryOnly>>().toEqualTypeOf<"clock">();
const memoryRepositoryReady = memoryRepositoryOnly.withClock(clock);
expectTypeOf<MissingNames<typeof memoryRepositoryReady>>().toEqualTypeOf<never>();
void (() => memoryRepositoryReady.boot());

const missingCustomMember = createApp({ role: "api" }).withModules([connectionsModule]);
expectTypeOf<MissingNames<typeof missingCustomMember>>().toEqualTypeOf<"connections">();
// @ts-expect-error an outstanding declared custom member refuses boot
void missingCustomMember.boot();
const customMemberReady = missingCustomMember.withMember("connections", connections);
expectTypeOf<MissingNames<typeof customMemberReady>>().toEqualTypeOf<never>();
void (() => customMemberReady.boot());
// @ts-expect-error a custom member must have the module-declared value type
void missingCustomMember.withMember("connections", { primary: () => 42 });
// @ts-expect-error a custom member name must be declared by an installed module
void missingCustomMember.withMember("connection", connections);
// @ts-expect-error custom members cannot be supplied before their declaration is installed
void createApp({ role: "api" }).withMember("connections", connections);

const missingSupplyToken = createApp({ role: "api" }).withModules([licenseConsumerModule]);
expectTypeOf<MissingNames<typeof missingSupplyToken>>().toEqualTypeOf<"peer.licenseSource">();
// @ts-expect-error the named external supply is required
void missingSupplyToken.boot();
const suppliedTokenReady = missingSupplyToken.provide({ licenseSource });
expectTypeOf<MissingNames<typeof suppliedTokenReady>>().toEqualTypeOf<never>();
void (() => suppliedTokenReady.boot());
// @ts-expect-error a supplied token keeps its declared API type
void missingSupplyToken.provide({ licenseSource: { resolve: () => 42 } });

expectTypeOf(packageEntry.createApp).toEqualTypeOf(createApp);
expectTypeOf(packageEntry.createApp).toEqualTypeOf(supplyEntry.createApp);
const overwritten = createApp({ role: "api" })
  .withClock(clock)
  .withClock(42)
  .withModules([clockModule]);
expectTypeOf<MissingNames<typeof overwritten>>().toEqualTypeOf<"clock">();

const withTransport = defineServerModule("annotation")
  .withApp(ClockApp)
  .withTransports({ protocol: "rest", router: () => ({}) });
const transportClock = createApp({ role: "api" }).withModules([withTransport]);
expectTypeOf<MissingNames<typeof transportClock>>().toEqualTypeOf<"clock">();

const openedTransport = createApp({ role: "api" }).expose(() => ({
  hosts: {
    rest: { mount: () => ({ protocol: "rest" as const }) },
    trpc: { mount: () => ({ protocol: "trpc" as const }) },
  },
  serve: () => void 0,
}));
type OpenedRuntime = Awaited<ReturnType<typeof openedTransport.boot>>;
expectTypeOf<OpenedRuntime["transports"]["rest"]>().toEqualTypeOf<
  readonly { protocol: "rest" }[]
>();
expectTypeOf<OpenedRuntime["transports"]["trpc"]>().toEqualTypeOf<
  Readonly<Record<string, { protocol: "trpc" }>>
>();
// @ts-expect-error a surface states both what mounts on it and what it serves
void createApp({ role: "api" }).expose(() => ({ hosts: {} }));

void createApp({ role: "worker" })
  .withService({ name: "producer", start: () => void 0, stop: () => void 0 })
  .boot();
// @ts-expect-error a lifecycle service must be closable
void createApp({ role: "worker" }).withService({ name: "producer", start: () => void 0 });

// @ts-expect-error incomplete state cannot widen to the default ready state
const widenedReady: ProcessSupply = createApp({ role: "api" }).withModules([
  clockModule,
  configModule,
  peerModule,
]);
void widenedReady.boot();

// @ts-expect-error callers cannot manufacture ready generic state
void new ProcessSupply({
  role: "api",
  modules: [clockModule, configModule, peerModule],
  members: {},
  config: {},
  peers: {},
}).boot();

// @ts-expect-error public properties cannot manufacture the private boot proof
void Object.assign(createApp({ role: "api" }).withModules([clockModule]), { clock }).boot();

const proofDoesNotLeak = createApp({ role: "api" }).withModules([clockModule]);
// @ts-expect-error the nominal boot proof is not exposed by the builder
void proofDoesNotLeak.__missing;

const clonedReady = {
  ...createApp({ role: "api" }).withModules([clockModule]).withClock(clock),
};
// @ts-expect-error spreading a ready builder drops the nominal receiver boot requires
void clonedReady.boot();

const runtimeTestedBoot = createApp({ role: "api" }).withModules([clockModule]);
// @ts-expect-error an outstanding requirement keeps boot non-object and non-callable
if (runtimeTestedBoot.boot instanceof Function) runtimeTestedBoot.boot();

type StageHelperName =
  | "startDependencies"
  | "startMembers"
  | "startRepositories"
  | "startConfiguration";
expectTypeOf<Extract<keyof typeof supplyEntry, StageHelperName>>().toEqualTypeOf<never>();
expectTypeOf<Extract<keyof typeof packageEntry, StageHelperName>>().toEqualTypeOf<never>();
// @ts-expect-error the dependency stage helper is private to admission
void supplyEntry.startDependencies(peerModule);
// @ts-expect-error the member stage helper is private to admission
void supplyEntry.startMembers(clockModule);
// @ts-expect-error the repository stage helper is private to admission
void supplyEntry.startRepositories(repositoryModule);
// @ts-expect-error the configuration stage helper is private to admission
void supplyEntry.startConfiguration(configModule);

function startStructurally(builder: { boot(): Promise<unknown> }) {
  return builder.boot();
}
// @ts-expect-error a looser structural interface cannot erase the boot refusal
void startStructurally(createApp({ role: "api" }).withModules([clockModule]));

const incompleteForIntersection = createApp({ role: "api" }).withModules([clockModule]);
// @ts-expect-error intersecting a callable boot shape cannot widen an incomplete builder
const callableIntersection: typeof incompleteForIntersection & { boot(): Promise<unknown> } =
  incompleteForIntersection;
void callableIntersection.boot();

// @ts-expect-error an explicitly widened module array carries no tuple proof
void createApp({ role: "api" }).withModules<SupplyModule[]>([clockModule]);

const widenedModules: readonly SupplyModule[] = [clockModule];
// @ts-expect-error passing modules through an array type discards their requirements
void createApp({ role: "api" }).withModules(widenedModules);

function installWidened(modules: readonly SupplyModule[]) {
  // @ts-expect-error a looser parameter cannot be treated as a checked module tuple
  return createApp({ role: "api" }).withModules(modules);
}
void installWidened;

function installWidenedModule(module: SupplyModule) {
  // @ts-expect-error tuple length does not recover requirements erased from its module
  return createApp({ role: "api" }).withModules([module]);
}
void installWidenedModule;

type NameEvidenceErasedModule = Omit<typeof clockModule, "name"> & {
  readonly name: string;
};
function installNameEvidenceErased(module: NameEvidenceErasedModule) {
  const builder = createApp({ role: "api" });
  // @ts-expect-error the module's name must remain literal through admission
  return builder.withModules([module]);
}
void installNameEvidenceErased;

type BroadSchemaModule = Omit<typeof clockModule, "configType"> & Pick<SupplyModule, "configType">;
function installBroadSchema(module: BroadSchemaModule) {
  // @ts-expect-error a broad schema cannot identify the module's own config slice
  return createApp({ role: "api" }).withModules([module]);
}
void installBroadSchema;

const unionArray: (typeof peerModule | typeof projectModule)[] = [peerModule];
// @ts-expect-error an array of possible modules is not evidence of an installed owner
void createApp({ role: "api" }).withModules(unionArray);

const unionInsideTuple: readonly [typeof peerModule | typeof projectModule] = [peerModule];
const possiblyInstalledInsideTuple = createApp({ role: "api" }).withModules(unionInsideTuple);
// @ts-expect-error an owner must be installed in every union branch inside a tuple element
void possiblyInstalledInsideTuple.boot();

const explicitUnionInsideTuple = createApp({ role: "api" }).withModules<
  [typeof peerModule | typeof projectModule]
>([peerModule]);
// @ts-expect-error an explicit tuple element union is not proof that its owner is installed
void explicitUnionInsideTuple.boot();

function modulesFromBranch(
  includeProject: boolean,
): readonly [typeof peerModule, typeof projectModule] | readonly [typeof peerModule] {
  return includeProject ? [peerModule, projectModule] : [peerModule];
}
const possiblyInstalledOwner = createApp({ role: "api" }).withModules(modulesFromBranch(false));
// @ts-expect-error a peer owner must be installed in every tuple-union branch
void possiblyInstalledOwner.boot();

type DependenciesErasedModule = Omit<typeof peerModule, "dependencies"> & {
  readonly dependencies: {};
};
function installDependenciesErased(module: DependenciesErasedModule) {
  // @ts-expect-error dependency evidence must survive until the module tuple is accepted
  return createApp({ role: "api" }).withModules([module]);
}
void installDependenciesErased;

type MembersEvidenceErasedModule = Omit<typeof clockModule, "members">;
function installMembersEvidenceErased(module: MembersEvidenceErasedModule) {
  // @ts-expect-error member evidence must survive until the module tuple is accepted
  return createApp({ role: "api" }).withModules([module]);
}
void installMembersEvidenceErased;

const indexedPeers: Record<string, ProjectApi> = {};
// @ts-expect-error an index signature does not prove the project key exists
void createApp({ role: "api" }).withModules([peerModule]).provide(indexedPeers).boot();

const indexedConfig: Record<string, { pepper: string }> = {};
// @ts-expect-error an index signature does not prove the api-key slice exists
void createApp({ role: "api" }).withConfig(indexedConfig).withModules([configModule]).boot();

const duplicateBeforeModules = createApp({ role: "api" })
  .provide({ project })
  .withModules([peerModule, projectModule]);
// @ts-expect-error installing an owner conflicts with the earlier stand-in
void duplicateBeforeModules.boot();

const duplicateAfterModules = createApp({ role: "api" })
  .withModules([peerModule, projectModule])
  .provide({ project });
// @ts-expect-error standing in for an installed owner is the same conflict
void duplicateAfterModules.boot();
