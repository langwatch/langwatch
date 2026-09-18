import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { z } from "zod";

import { defineWebModule, type UiDocument } from "../src/index.ts";

export const mountElement = { id: "root" } as HTMLElement;
export const documentRoot: UiDocument = {
  getElementById: (id) => (id === "root" ? mountElement : null),
  querySelector: () => null,
};

export const publicAppConfig: PublicAppConfig = {
  appBaseUrl: "https://app.example.test",
  gatewayBaseUrl: "https://gateway.example.test",
  deployment: "self-hosted",
  mode: "test",
  telemetry: {
    browserTracing: false,
    sampleRatio: 0,
  },
  capabilities: {
    email: true,
    nlp: true,
    langevals: false,
  },
  passkeys: false,
  identityFrontDoor: false,
};

export const transportModule = defineWebModule("screen").withScreens({
  "pages/home": {
    path: "/home",
  },
});

export const sessionModule = defineWebModule("session-only").requires(["session"] as const);

export const configModule = defineWebModule("configuration").withConfig(
  z.strictObject({ mode: z.enum(["development", "test", "production"]) }),
  (config) => ({ mode: config.mode }),
);

export const facilityModule = defineWebModule("facilities").requires([
  "feedback",
  "storage",
  "document-title",
  "analytics",
] as const);

export const shellModule = defineWebModule("shell").requires([
  "toaster",
  "graphics-quality",
  "boot-refusal",
] as const);

export const allModules = [
  transportModule,
  sessionModule,
  configModule,
  facilityModule,
  shellModule,
] as const;

export const browserUiTransport = { request: () => Promise.resolve() };
export const useBrowserUiSession = () => ({ actor: null });
export const browserUiFeedback = { failed: () => void 0 };
export const browserUiStorage = { read: () => void 0 };
export const browserUiDocumentTitle = { set: () => void 0 };
export const browserUiAnalytics = { track: () => void 0 };
export const UiErrorToaster = () => null;
export const GraphicsQualityProvider = () => null;
export const UiBootRefusalScreen = () => null;
