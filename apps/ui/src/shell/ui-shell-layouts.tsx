import type { UiFeatureConfig } from "../ui-feature-config";
import type { UiRootHostServices } from "./ui-root-host-services";

/** The frames the shell draws pages in; the chrome draws over the loaded capabilities. */
export function uiShellLayouts({
  root,
  config,
}: {
  root: UiRootHostServices;
  config: UiFeatureConfig;
}) {
  return {
    auth: async () => {
      const { uiAuthHost } = await import("./ui-auth-host");
      return { default: uiAuthHost({ auth: root.authHost, config }) };
    },
    chrome: async () => {
      const { default: UiAppChrome } = await import("./ui-app-chrome");
      return {
        default: function UiAppChromeOverHostServices() {
          return <UiAppChrome capabilities={root} process={config.process} />;
        },
      };
    },
    "full-screen": async () => {
      const { default: UiAppChrome } = await import("./ui-app-chrome");
      return {
        default: function UiFullScreenOverHostServices() {
          return <UiAppChrome capabilities={root} process={config.process} fullScreen />;
        },
      };
    },
  };
}
