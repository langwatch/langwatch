import type { UiRootCapabilities } from "./ui-root-capabilities";

/** The frames the shell draws pages in; the chrome draws over the loaded capabilities. */
export function uiShellLayouts(root: UiRootCapabilities) {
  return {
    auth: async () => {
      const { uiAuthHost } = await import("./ui-auth-host");
      return { default: uiAuthHost(root.authHost) };
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
