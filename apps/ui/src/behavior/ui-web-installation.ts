import type { RouteObject } from "react-router";
import type { UiFeatureApiBinding } from "./ui-feature-transport";
import type { UiFeature } from "./ui-feature";

export type UiWebRouteParent = "project";

export type WebInstallContext = Readonly<{
  routes(parent: UiWebRouteParent, routes: readonly RouteObject[]): void;
  api(binding: UiFeatureApiBinding): void;
}>;

export type WebInstallation = Readonly<{
  name: string;
  install(ui: WebInstallContext): void;
}>;

export type UiWebInstall = Readonly<{
  routes: Readonly<Record<UiWebRouteParent, readonly RouteObject[]>>;
  apis: readonly UiFeatureApiBinding[];
}>;

export function collectWebInstallations({
  installations,
}: Readonly<{
  installations: readonly (WebInstallation | UiFeature)[];
}>): UiWebInstall {
  const routes: Record<UiWebRouteParent, RouteObject[]> = { project: [] };
  const apis: UiFeatureApiBinding[] = [];
  const names = new Set<string>();
  const pages = new Map<string, string>();

  assertInstallationNames(installations);

  const contextFor = (installationName: string): WebInstallContext => ({
    routes: (parent, contribution) => {
      for (const route of contribution) {
        const key = route.path ?? "<pathless>";
        const owner = pages.get(`${parent}:${key}`);
        if (owner) throw new Error(`Route ${JSON.stringify(key)} is installed twice: ${owner}`);
        pages.set(`${parent}:${key}`, installationName);
        routes[parent].push(route);
      }
    },
    api: (binding) => {
      if (names.has(binding.name))
        throw new Error(`API provider ${binding.name} is installed twice`);
      names.add(binding.name);
      apis.push(binding);
    },
  });

  for (const installation of installations) {
    const context = contextFor(installation.name);
    if ("install" in installation) {
      installation.install(context);
    } else if (installation.api) {
      context.api(installation.api);
    }
  }
  return { routes, apis };
}

function assertInstallationNames(installations: readonly (WebInstallation | UiFeature)[]): void {
  const installationNames = new Set<string>();
  for (const installation of installations) {
    if (!installation.name.trim()) throw new Error("A web installation needs a name.");
    if (installationNames.has(installation.name)) {
      throw new Error(`Web installation ${installation.name} is installed twice`);
    }
    installationNames.add(installation.name);
  }
}
