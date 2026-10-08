import type { UiFeatureConfig } from "../ui-feature-config";
import type { UiRootCapabilities } from "./ui-root-capabilities";

/** The frames the shell draws pages in; the chrome draws over the loaded capabilities. */
export function uiShellLayouts({
  root,
  config,
}: {
  root: UiRootCapabilities;
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
        default: function UiAppChromeOverCapabilities() {
          return <UiAppChrome capabilities={root} />;
        },
      };
    },
    "full-screen": async () => {
      const { default: UiAppChrome } = await import("./ui-app-chrome");
      return {
        default: function UiFullScreenOverCapabilities() {
          return <UiAppChrome capabilities={root} fullScreen />;
        },
      };
    },
  };
}
