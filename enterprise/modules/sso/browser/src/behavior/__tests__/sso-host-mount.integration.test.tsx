/**
 * @vitest-environment jsdom
 * "Test sign-in" runs the sign-in auth lent under its token, and refuses by
 * name when nothing lent it. Spec: specs/identity/sso-assertion-refusals.feature.
 */

import { SsoTestSignInToken, type SsoTestSignInOperations } from "@langwatch/auth-contract";
import {
  UiCapabilityContextProvider,
  UiCapabilityUnavailableError,
  UiScope,
  type UiActiveScope,
} from "@langwatch/browser-host/capabilities";
import { uiDeclarations, type UiLend } from "@langwatch/browser-host/declarations";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSsoHost } from "../../model/sso-host.ts";
import SsoHostMount from "../sso-host-mount.tsx";

class OrganizationScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: null };
  }
}

function renderHost(lends: readonly UiLend[]) {
  const capabilities = {
    ...createUiCapabilitiesFromHost({ route: () => ({ params: {}, query: {} }), navigate() {} }),
    scope: new OrganizationScope(),
    declarations: uiDeclarations([{ name: "auth", installation: { capabilities: {}, lends } }]),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <UiCapabilityContextProvider value={capabilities}>
      <SsoHostMount>{children}</SsoHostMount>
    </UiCapabilityContextProvider>
  );

  return renderHook(() => useSsoHost(), { wrapper }).result.current;
}

afterEach(cleanup);

describe("given auth lent its sign-in under the token", () => {
  it("starts that sign-in for the connection and hands back its answer", async () => {
    const refusal = { error: { code: "PROVIDER_NOT_FOUND", status: 404 } };
    const testSignIn = vi.fn<SsoTestSignInOperations["testSignIn"]>().mockResolvedValue(refusal);
    const signIn: SsoTestSignInOperations = { testSignIn, normalizeSignInErrorCode: (c) => c };
    const host = renderHost([
      { token: SsoTestSignInToken, load: () => Promise.resolve({ default: signIn }) },
    ]);

    const answer = await host.testSignIn({ connectionId: "conn-1", callbackQuery: {} });

    expect(testSignIn).toHaveBeenCalledWith({ connectionId: "conn-1", callbackQuery: {} });
    expect(answer).toEqual(refusal);
  });
});

describe("given nothing lent the sign-in", () => {
  it("refuses by name rather than report a test nobody ran", async () => {
    const host = renderHost([]);

    await expect(
      host.testSignIn({ connectionId: "conn-1", callbackQuery: {} }),
    ).rejects.toBeInstanceOf(UiCapabilityUnavailableError);
  });
});
