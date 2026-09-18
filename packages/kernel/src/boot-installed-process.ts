import { ApplicationBuilder } from "./application.ts";
import type {
  InstallableServerFeature,
  ModuleSecretsScope,
  ServerRole,
} from "./feature-installer.ts";
import type { MemberSource } from "./module-members.ts";
import type { ExposedSurface } from "./process-supply.ts";
import type { TransportPeers } from "./transport-peers.ts";

/** Runtime translation after process composition has resolved its declared supplies. */
export async function bootInstalledProcess(options: {
  role: ServerRole;
  modules: readonly InstallableServerFeature<never>[];
  config: Readonly<Record<string, unknown>>;
  members: MemberSource<Record<string, unknown>>;
  /** Scopes the process resolver per module; omitted where none was stated. */
  secrets?: ModuleSecretsScope;
  surface?: (peers: TransportPeers) => ExposedSurface<unknown, unknown>;
}) {
  let surface: ExposedSurface<unknown, unknown> | undefined;
  const builder = new ApplicationBuilder<Record<string, unknown>, unknown, unknown>(options);
  const mounted = options.surface
    ? builder.withTransports(
        (peers) => {
          surface = options.surface?.(peers);
          if (!surface) throw new Error("The API surface was not constructed.");
          return surface.hosts;
        },
        () => surface?.serve(),
      )
    : builder;
  // Each declaration validates its config and named members before constructing its App.
  return mounted
    .withModules(options.modules as readonly InstallableServerFeature<Record<string, unknown>>[])
    .boot();
}
