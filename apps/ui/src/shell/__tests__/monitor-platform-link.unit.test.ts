import { installedModuleDrawers } from "@langwatch/browser/module-drawers";
import { describe, expect, it } from "vitest";

import { browserModules } from "../../browser-modules.generated";

/** The path the monitors REST API answers as `platformUrl` (monitor.rest.integration pins it). */
const MONITOR_LINK =
  "/acme/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=monitor-1";

describe("given a monitor's platform link", () => {
  describe("when the installed modules' drawers are composed", () => {
    /** @scenario "A monitor's platform link opens the online evaluation it names" */
    it("names a drawer the registry holds, carrying the monitor's id for it to read", () => {
      const params = new URL(MONITOR_LINK, "https://app.langwatch.test").searchParams;
      const registry = installedModuleDrawers(browserModules);

      expect(Object.keys(registry)).toContain(params.get("drawer.open"));
      expect(params.get("drawer.monitorId")).toBe("monitor-1");
    });
  });
});
