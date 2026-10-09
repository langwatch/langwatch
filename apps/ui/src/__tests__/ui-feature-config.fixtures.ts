import { createUi, type UiDocument } from "@langwatch/browser";
import { readUiProcessConfig } from "@langwatch/browser/supply";
import type { PublicAppConfig } from "@langwatch/config/public-app-config";

import { browserModules } from "../browser-modules.generated.ts";
import { uiFeatureConfigOf, type UiFeatureConfig } from "../ui-feature-config";

/** The page's config as the api serves it: one slice per owner, by name. */
export const servedConfig = {
  process: {
    appBaseUrl: "https://app.langwatch.test",
    mode: "production",
    deployment: "saas",
    nlp: false,
  },
  auth: {
    passkeys: true,
    identityFrontDoor: false,
    authProvider: "auth0",
    emailPasswordEnabled: true,
    signUpMode: "invite_only",
  },
  authz: {},
  billing: {},
  evaluation: { langevals: true },
  gateway: { gatewayBaseUrl: "https://gateway.langwatch.test" },
  notification: { email: true },
  ops: { cloudOps: false },
  rum: { enabled: true, sampleRatio: 0.1 },
} satisfies PublicAppConfig;

const mount = { id: "root" } as HTMLElement;
const document: UiDocument = {
  getElementById: (id) => (id === "root" ? mount : null),
  querySelector: () => null,
};

/** Composed exactly as `main.tsx` composes it: the supply, then the shell's reading. */
export async function uiFeatureConfigFrom(served: PublicAppConfig): Promise<UiFeatureConfig> {
  const installed = await createUi({ document, mount: "root" })
    .withModules(browserModules)
    .withTransport({ query: () => Promise.resolve(null) })
    .withInjectedConfig(() => served)
    .render();
  return uiFeatureConfigOf({ process: readUiProcessConfig(served), installed: installed.config });
}
