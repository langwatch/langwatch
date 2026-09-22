// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import {
  TEST_SIGN_IN_MARKER,
  testSignInCallbackQuery,
  testSignInCallbackVerdict,
} from "../test-sign-in-callback.ts";

describe("where a test sign-in comes back to", () => {
  it("keeps the rest of the address and drops the last attempt's verdict", () => {
    expect(
      testSignInCallbackQuery({
        query: { tab: "sso", error: "access_denied", error_description: "stale" },
        connectionId: "conn-1",
      }),
    ).toEqual({ tab: "sso", [TEST_SIGN_IN_MARKER]: "conn-1" });
  });

  it("marks the return as this connection's, over any other test's mark", () => {
    expect(
      testSignInCallbackQuery({ query: { ssoTest: "conn-9" }, connectionId: "conn-1" }),
    ).toEqual({ ssoTest: "conn-1" });
  });
});

describe("what a bounce on this page belongs to", () => {
  it("is this test's when the mark names this connection", () => {
    expect(
      testSignInCallbackVerdict({
        query: { error: "access_denied", error_description: "AADSTS50105", ssoTest: "conn-1" },
        connectionId: "conn-1",
      }),
    ).toEqual({ code: "access_denied", description: "AADSTS50105" });
  });

  it("is nobody's when the mark is missing or names another connection", () => {
    expect(
      testSignInCallbackVerdict({ query: { error: "access_denied" }, connectionId: "conn-1" }),
    ).toBeNull();
    expect(
      testSignInCallbackVerdict({
        query: { error: "access_denied", ssoTest: "conn-9" },
        connectionId: "conn-1",
      }),
    ).toBeNull();
  });

  it("is nothing at all when no error came back", () => {
    expect(
      testSignInCallbackVerdict({ query: { ssoTest: "conn-1" }, connectionId: "conn-1" }),
    ).toBeNull();
  });
});
