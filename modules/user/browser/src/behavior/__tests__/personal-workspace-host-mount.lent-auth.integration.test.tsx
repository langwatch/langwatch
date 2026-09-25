// @vitest-environment jsdom
/**
 * The host calls through the ceremonies auth lends, and answers honestly where none is lent.
 * Spec: specs/identity/mfa-and-session-shape.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { uiDeclarations, type UiDeclaringModule } from "@langwatch/browser-host/declarations";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../personal-workspace-api.ts", () => ({
  personalWorkspaceApi: { organization: { getAll: { useQuery: () => ({ data: [] }) } } },
}));

import {
  usePersonalWorkspaceHost,
  type PasskeyOutcome,
  type PersonalWorkspaceHostApi,
  type TwoStepAnswer,
  type TwoStepSetup,
} from "../../model/personal-workspace-host.ts";
import PersonalWorkspaceHostMount from "../personal-workspace-host-mount.tsx";

class TestScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: null, projectId: null };
  }
}

const DONE: PasskeyOutcome = { ok: true };

const SETUP: TwoStepSetup = {
  setupUri: "otpauth://totp/LangWatch:sam?secret=ABCD",
  backupCodes: ["1111"],
};

const passkeys = {
  list: vi.fn(async () => [{ id: "pk-1", name: "Laptop", createdAt: "2026-09-01T00:00:00Z" }]),
  register: vi.fn(async () => DONE),
  rename: vi.fn(async () => DONE),
  remove: vi.fn(async () => DONE),
};

const twoStepVerification = {
  start: vi.fn(async (): Promise<TwoStepAnswer<TwoStepSetup>> => ({ ok: true, value: SETUP })),
  confirm: vi.fn(async (): Promise<TwoStepAnswer<{ confirmed: true }>> => ({
    ok: true,
    value: { confirmed: true },
  })),
  regenerateBackupCodes: vi.fn(
    async (): Promise<TwoStepAnswer<{ backupCodes: readonly string[] }>> => ({
      ok: true,
      value: { backupCodes: ["2222"] },
    }),
  ),
};

const signInMethodLinking = {
  link: vi.fn(async () => DONE),
};

const AUTH: UiDeclaringModule = {
  name: "auth",
  installation: {
    capabilities: {
      passkeys: { load: async () => ({ default: passkeys }) },
      twoStepVerification: { load: async () => ({ default: twoStepVerification }) },
      signInMethodLinking: { load: async () => ({ default: signInMethodLinking }) },
    },
  },
};

function mountedHost(modules: readonly UiDeclaringModule[]): PersonalWorkspaceHostApi {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    scope: new TestScope(),
    declarations: uiDeclarations(modules),
  };
  const captured: PersonalWorkspaceHostApi[] = [];
  function Capture() {
    captured.push(usePersonalWorkspaceHost());
    return null;
  }
  function Harness({ children }: { children: ReactNode }) {
    return (
      <UiCapabilityContextProvider value={capabilities}>
        <PersonalWorkspaceHostMount>{children}</PersonalWorkspaceHostMount>
      </UiCapabilityContextProvider>
    );
  }
  render(<Capture />, { wrapper: Harness });
  const host = captured.at(-1);
  if (!host) throw new Error("the host mount rendered no host");
  return host;
}

describe("given auth lends its ceremonies through its declaration", () => {
  describe("when a screen manages the reader's passkeys", () => {
    it("reads and changes them through auth's ceremonies", async () => {
      const host = mountedHost([AUTH]);

      expect(await host.listPasskeys()).toEqual([
        { id: "pk-1", name: "Laptop", createdAt: "2026-09-01T00:00:00Z" },
      ]);
      expect(await host.registerPasskey()).toEqual({ ok: true });
      await host.renamePasskey({ id: "pk-1", name: "Desk" });
      await host.removePasskey({ id: "pk-1" });

      expect(passkeys.rename).toHaveBeenCalledWith({ id: "pk-1", name: "Desk" });
      expect(passkeys.remove).toHaveBeenCalledWith({ id: "pk-1" });
    });
  });

  describe("when a screen sets two-step verification up", () => {
    it("starts, confirms and regenerates through auth's ceremonies", async () => {
      const host = mountedHost([AUTH]);

      expect(await host.startTwoStepSetup({ password: "hunter2" })).toEqual({
        ok: true,
        value: SETUP,
      });
      await host.confirmTwoStepSetup({ code: "123456" });
      expect(await host.regenerateBackupCodes({})).toEqual({
        ok: true,
        value: { backupCodes: ["2222"] },
      });

      expect(twoStepVerification.start).toHaveBeenCalledWith({ password: "hunter2" });
      expect(twoStepVerification.confirm).toHaveBeenCalledWith({ code: "123456" });
    });
  });

  describe("when the reader links another sign-in method", () => {
    it("starts the link through auth's ceremony for that provider", async () => {
      const host = mountedHost([AUTH]);

      expect(await host.linkSignInMethod("github")).toEqual({ ok: true });
      expect(signInMethodLinking.link).toHaveBeenCalledWith({ provider: "github" });
    });
  });
});

describe("given a composition where nothing lends the ceremonies", () => {
  it("holds no passkeys, and refuses a ceremony rather than pretending it ran", async () => {
    const host = mountedHost([]);

    expect(await host.listPasskeys()).toEqual([]);
    expect(await host.registerPasskey()).toEqual({ ok: false, cancelled: false });
    expect((await host.startTwoStepSetup({})).ok).toBe(false);
    expect((await host.linkSignInMethod("github")).ok).toBe(false);
  });
});
