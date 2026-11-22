import { expectTypeOf } from "vitest";

import { createUi, UiSupply } from "../src/ui-supply.ts";
import type { SupplyModule } from "../src/web-module.ts";
import {
  allModules,
  browserUiAnalytics,
  browserUiDocumentTitle,
  browserUiFeedback,
  browserUiStorage,
  browserUiTransport,
  configModule,
  documentRoot,
  facilityModule,
  GraphicsQualityProvider,
  publicAppConfig,
  sessionModule,
  shellModule,
  transportModule,
  UiBootRefusalScreen,
  UiErrorToaster,
  useBrowserUiSession,
} from "../tests/ui-supply.fixtures.ts";

type MissingNames<Supply> =
  Supply extends UiSupply<infer _Modules, infer _Supplied, infer Outstanding>
    ? keyof Outstanding & string
    : never;

const minimal = createUi({ document: documentRoot, mount: "root" }).withModules([transportModule]);
expectTypeOf<MissingNames<typeof minimal>>().toEqualTypeOf<"transport">();
// @ts-expect-error an outstanding transport refuses render
void minimal.render();
const suppliedTransport = minimal.withTransport(browserUiTransport);
expectTypeOf<MissingNames<typeof suppliedTransport>>().toEqualTypeOf<never>();
expectTypeOf<Parameters<typeof suppliedTransport.render>>().toEqualTypeOf<[]>();
void (() => suppliedTransport.render());

const suppliedFirst = createUi({ document: documentRoot, mount: "root" })
  .withTransport(browserUiTransport)
  .withModules([transportModule]);
expectTypeOf<MissingNames<typeof suppliedFirst>>().toEqualTypeOf<never>();

const noModules = createUi({ document: documentRoot, mount: "root" });
expectTypeOf<MissingNames<typeof noModules>>().toEqualTypeOf<never>();
void (() => noModules.render());

const missingConfig = createUi({ document: documentRoot, mount: "root" }).withModules([
  configModule,
]);
expectTypeOf<MissingNames<typeof missingConfig>>().toEqualTypeOf<"injected-config">();
// @ts-expect-error a module config slice requires a reader, not a value
void missingConfig.render();
const configured = missingConfig.withInjectedConfig(() => publicAppConfig);
expectTypeOf<MissingNames<typeof configured>>().toEqualTypeOf<never>();
void (() => configured.render());

const runtimeFailureStillCompiles = missingConfig.withInjectedConfig(() => {
  throw new Error("document content is absent at runtime");
});
void (() => runtimeFailureStillCompiles.render());

const missingSession = createUi({ document: documentRoot, mount: "root" }).withModules([
  sessionModule,
]);
expectTypeOf<MissingNames<typeof missingSession>>().toEqualTypeOf<"session">();
// @ts-expect-error a declared session requirement needs the session source
void missingSession.render();

const partialFacilities = createUi({ document: documentRoot, mount: "root" })
  .withModules([facilityModule])
  .withFacilities((facilities) => facilities.withFeedback(browserUiFeedback));
expectTypeOf<MissingNames<typeof partialFacilities>>().toEqualTypeOf<
  "storage" | "document-title" | "analytics"
>();
// @ts-expect-error one unrelated facility does not satisfy the others
void partialFacilities.render();

const partialShell = createUi({ document: documentRoot, mount: "root" })
  .withModules([shellModule])
  .withShell((shell) => shell.withToaster(UiErrorToaster));
expectTypeOf<MissingNames<typeof partialShell>>().toEqualTypeOf<
  "graphics-quality" | "boot-refusal"
>();
// @ts-expect-error one shell component does not satisfy the others
void partialShell.render();

const all = createUi({ document: documentRoot, mount: "root" }).withModules(allModules);
expectTypeOf<MissingNames<typeof all>>().toEqualTypeOf<
  | "injected-config"
  | "transport"
  | "session"
  | "feedback"
  | "storage"
  | "document-title"
  | "analytics"
  | "toaster"
  | "graphics-quality"
  | "boot-refusal"
>();
// @ts-expect-error every outstanding requirement refuses one render
void all.render();

const ready = all
  .withInjectedConfig(() => publicAppConfig)
  .withTransport(browserUiTransport)
  .withSession(useBrowserUiSession)
  .withFacilities((facilities) =>
    facilities
      .withFeedback(browserUiFeedback)
      .withStorage(browserUiStorage)
      .withDocumentTitle(browserUiDocumentTitle)
      .withAnalytics(browserUiAnalytics),
  )
  .withShell((shell) =>
    shell
      .withToaster(UiErrorToaster)
      .withGraphicsQuality(GraphicsQualityProvider)
      .withBootRefusal(UiBootRefusalScreen),
  );
expectTypeOf<MissingNames<typeof ready>>().toEqualTypeOf<never>();
void (() => ready.render());

// @ts-expect-error render takes no arguments
void ready.render({});

// @ts-expect-error incomplete state cannot widen to the default ready state
const widenedReady: UiSupply = minimal;
void widenedReady.render();

// @ts-expect-error callers cannot manufacture ready generic state
void new UiSupply({ document: documentRoot, mount: "root", modules: [], supplied: {} }).render();

// @ts-expect-error public properties cannot manufacture the private render proof
void Object.assign(minimal, { transport: browserUiTransport }).render();

// Compiles by design (not a hole): instanceof narrows MissingUiSupply &
// Function to callable, and Object.assign types render's own key loosely.
// Both are refused at runtime — tests/ui-supply.unit.test.ts pins both.
if (minimal.render instanceof Function) void minimal.render();
void Object.assign(minimal, { render: async () => ({}) }).render();

const proofDoesNotLeak = createUi({ document: documentRoot, mount: "root" }).withModules([
  transportModule,
]);
// @ts-expect-error the nominal render proof is not exposed by the builder
void Object.assign(proofDoesNotLeak, proofDoesNotLeak.__missing).render();

function renderStructurally(builder: { render(): Promise<unknown> }) {
  return builder.render();
}
// @ts-expect-error a looser structural interface cannot erase the refusal
void renderStructurally(minimal);

const incompleteForIntersection = createUi({
  document: documentRoot,
  mount: "root",
}).withModules([transportModule]);
// @ts-expect-error intersecting a callable render shape cannot widen an incomplete builder
const callableIntersection: typeof incompleteForIntersection & {
  render(): Promise<unknown>;
} = incompleteForIntersection;
void callableIntersection.render();

// @ts-expect-error an explicitly widened module array carries no tuple proof
void createUi({ document: documentRoot, mount: "root" }).withModules<SupplyModule[]>([
  transportModule,
]);

const widenedModules: readonly SupplyModule[] = [transportModule];
// @ts-expect-error passing modules through an array type discards their requirements
void createUi({ document: documentRoot, mount: "root" }).withModules(widenedModules);

function installWidened(modules: readonly SupplyModule[]) {
  // @ts-expect-error a looser parameter cannot be treated as a checked module tuple
  return createUi({ document: documentRoot, mount: "root" }).withModules(modules);
}
void installWidened;

function installWidenedModule(module: SupplyModule) {
  // @ts-expect-error tuple length does not recover requirements erased from its module
  return createUi({ document: documentRoot, mount: "root" }).withModules([module]);
}
void installWidenedModule;

type NamedWidenedModule = SupplyModule & {
  readonly name: "screen";
  readonly unrelated: true;
};
function installNamedWidenedModule(module: NamedWidenedModule) {
  // @ts-expect-error a literal public name does not recover erased module requirements
  return createUi({ document: documentRoot, mount: "root" }).withModules([module]);
}
void installNamedWidenedModule;

const unionArray: (typeof transportModule | typeof sessionModule)[] = [transportModule];
// @ts-expect-error an array of possible modules is not a literal installation tuple
void createUi({ document: documentRoot, mount: "root" }).withModules(unionArray);

function modulesFromBranch(
  includeSession: boolean,
): readonly [typeof transportModule, typeof sessionModule] | readonly [typeof transportModule] {
  return includeSession ? [transportModule, sessionModule] : [transportModule];
}
const possibleSession = createUi({ document: documentRoot, mount: "root" })
  .withModules(modulesFromBranch(false))
  .withTransport(browserUiTransport);
// @ts-expect-error requirements from every tuple-union branch remain outstanding
void possibleSession.render();
void (() => possibleSession.withSession(useBrowserUiSession).render());

// @ts-expect-error the browser supply exposes no secret
void ready.withSecrets({ read: () => "secret" });
// @ts-expect-error the browser supply exposes no encryption key
void ready.withEncryption({ encrypt: (value: string) => value });
