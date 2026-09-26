/**
 * `api-keys create` answers 403 to an organization admin, because a CLI login key is minted without
 * `organization:manage` on purpose. Nothing in the refusal said so, so it read as a missing role
 * rather than a login that was never given the permission.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("../governance/config", () => ({ loadConfig: config.load }));

import {
  resetFallbackCredentialHolder,
  runWithCredentialHolder,
  setResolvedApiKey,
} from "@/internal/credentialContext";

import { LOGIN_MANAGEMENT_PERMISSIONS, loginPermissionsHint } from "../loginScopeHint";

const LOGIN_KEY = "sk-lw-login_secret";

const loginWith = (permissions?: string[]) =>
  config.load.mockReturnValue({
    cli_api_key: LOGIN_KEY,
    cli_api_key_scope: {
      kind: "organization",
      project_ids: [],
      ...(permissions ? { permissions } : {}),
    },
  });

/** The hint as a request that authenticated with `key` would read it. */
const hintFor = (key: string | undefined, code = "unauthorized") =>
  runWithCredentialHolder(() => {
    if (key) setResolvedApiKey(key);
    return loginPermissionsHint(code);
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetFallbackCredentialHolder();
});

describe("given a command refused as unauthorized while running as the login", () => {
  /** @scenario "the refusal lists the permissions the login was minted with" */
  it("lists the permissions the login carries", () => {
    loginWith(["project:view", "trace:view"]);

    const hint = hintFor(LOGIN_KEY);

    expect(hint).toContain("project:view");
    expect(hint).toContain("trace:view");
    expect(hint).toContain("langwatch login");
  });

  it("says a permission it does not carry is refused whatever the role", () => {
    loginWith(["project:view"]);

    expect(hintFor(LOGIN_KEY)).toContain("whatever your role is");
  });

  it("sorts the slugs, so the same login always reads the same way", () => {
    loginWith(["trace:view", "project:view"]);

    expect(hintFor(LOGIN_KEY)).toContain("project:view, trace:view");
  });

  /** @scenario "a login that recorded no permissions adds nothing" */
  it("adds nothing when the login recorded no permissions", () => {
    loginWith(undefined);

    expect(hintFor(LOGIN_KEY)).toBeUndefined();
  });

  it("adds nothing when there is no login on this machine", () => {
    config.load.mockReturnValue(undefined);

    expect(hintFor(LOGIN_KEY)).toBeUndefined();
  });

  it("adds nothing rather than failing twice when the config cannot be read", () => {
    config.load.mockImplementation(() => {
      throw new Error("unreadable");
    });

    expect(hintFor(LOGIN_KEY)).toBeUndefined();
  });
});

describe("given the request authenticated with a key that is not the login", () => {
  /** @scenario "a refusal for another key does not list the login's permissions" */
  it("adds nothing, since those permissions are not the ones that were refused", () => {
    loginWith(["project:view", "trace:view"]);

    expect(hintFor("sk-lw-some-other-key")).toBeUndefined();
  });

  it("adds nothing when no credential resolved at all", () => {
    loginWith(["project:view"]);

    expect(hintFor(undefined)).toBeUndefined();
  });
});

describe("given a command refused for a management permission while running as the login", () => {
  const refusalFor = (key: string | undefined, code: string, permission: string) =>
    runWithCredentialHolder(() => {
      if (key) setResolvedApiKey(key);
      return loginPermissionsHint(code, { permission });
    });

  /** @scenario A command refused for management access on a CLI login key names the re-login command */
  it("names the re-login for every management permission, whichever door refused it", () => {
    loginWith(["project:view", "traces:view"]);

    for (const permission of LOGIN_MANAGEMENT_PERMISSIONS) {
      for (const code of [
        "insufficient_permissions",
        "permission_denied",
        "api_key_permission_denied",
      ]) {
        const hint = refusalFor(LOGIN_KEY, code, permission);
        expect(hint).toContain("langwatch login --device --management");
        expect(hint).toContain(permission);
      }
    }
  });

  /** @scenario A command refused for management access on a CLI login key names the re-login command */
  it("names it for a login that recorded no permissions, since those leave management out", () => {
    loginWith(undefined);

    expect(refusalFor(LOGIN_KEY, "insufficient_permissions", "organization:manage")).toContain(
      "--management",
    );
  });

  it("adds nothing when the login already carries the refused permission, since the role refused it", () => {
    loginWith(["team:manage", "team:view"]);

    expect(refusalFor(LOGIN_KEY, "insufficient_permissions", "team:manage")).toBeUndefined();
  });

  it("adds nothing when the refused key is not the login", () => {
    loginWith(["project:view"]);

    expect(
      refusalFor("sk-lw-some-other-key", "insufficient_permissions", "team:manage"),
    ).toBeUndefined();
  });

  it("does not name the management re-login for a permission a plain login already covers", () => {
    loginWith(["traces:view"]);

    expect(refusalFor(LOGIN_KEY, "permission_denied", "project:create")).toBeUndefined();
  });
});

describe("given a failure that is not an authorization one", () => {
  /** @scenario "a failure that is not an authorization one is left alone" */
  it("adds no permissions line", () => {
    loginWith(["project:view"]);

    expect(hintFor(LOGIN_KEY, "not_found")).toBeUndefined();
    expect(hintFor(LOGIN_KEY, "validation_error")).toBeUndefined();
  });
});
