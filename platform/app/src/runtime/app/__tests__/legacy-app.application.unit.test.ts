import { FeatureDefinition } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";
import type { App } from "~/server/app-layer/app";
import { AppBoot } from "../boot";
import { createLegacyAppRuntime } from "../legacy-app.application";

function closeableApp(close: () => Promise<void>): App {
  const app: App = Object.create(Object.prototype) as App;
  Object.defineProperty(app, "close", { value: close });
  return app;
}

async function completeWithin(promise: Promise<void>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("runtime close did not settle")), 100);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

describe("legacy App runtime resource ownership", () => {
  it("borrows AppBoot resources without waiting on its own close", async () => {
    const phases: string[] = [];
    const closeApp = vi.fn(async () => {
      phases.push("app");
    });
    const feature = FeatureDefinition.create<Record<string, never>>({
      name: "test-resource",
      services({ resources }) {
        resources.own("feature", () => {
          phases.push("feature");
        });
      },
    });
    const app = closeableApp(closeApp);
    const boot = new AppBoot({
      compose: async (_config, resources) => {
        resources.own("root", () => {
          phases.push("root");
        });
        return createLegacyAppRuntime({ composeApp: () => app, features: [feature], resources });
      },
    });

    const runtime = await boot.boot({ NODE_ENV: "test" });

    await completeWithin(Promise.all([runtime.close(), runtime.close()]).then(() => undefined));

    expect(closeApp).toHaveBeenCalledOnce();
    expect(phases).toEqual(["app", "feature", "root"]);
  });

  it("owns an internal scope when no process scope is supplied", async () => {
    const phases: string[] = [];
    const closeApp = vi.fn(async () => {
      phases.push("app");
    });
    const feature = FeatureDefinition.create<Record<string, never>>({
      name: "test-resource",
      services({ resources }) {
        resources.own("feature", () => {
          phases.push("feature");
        });
      },
    });
    const app = closeableApp(closeApp);
    const runtime = await createLegacyAppRuntime({ composeApp: () => app, features: [feature] });

    await Promise.all([runtime.close(), runtime.close()]);

    expect(closeApp).toHaveBeenCalledOnce();
    expect(phases).toEqual(["app", "feature"]);
  });
});
