/**
 * `api-keys create` answers 403 to an organization admin, because a CLI login
 * key is minted without `organization:manage` on purpose. Nothing in the
 * refusal said so, so it read as a missing role rather than a login that was
 * never given the permission.
 */
import { describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("../governance/config", () => ({ loadConfig: config.load }));

import { loginPermissionsHint } from "../loginScopeHint";

const loginWith = (permissions?: string[]) =>
  config.load.mockReturnValue({
    cli_api_key_scope: {
      kind: "organization",
      project_ids: [],
      ...(permissions ? { permissions } : {}),
    },
  });

describe("given a command was refused as unauthorized", () => {
  /** @scenario "the refusal lists the permissions the login was minted with" */
  it("lists the permissions the login carries", () => {
    loginWith(["project:view", "trace:view"]);

    const hint = loginPermissionsHint("unauthorized");

    expect(hint).toContain("project:view");
    expect(hint).toContain("trace:view");
    expect(hint).toContain("langwatch login");
  });

  it("says a permission it does not carry is refused whatever the role", () => {
    loginWith(["project:view"]);

    expect(loginPermissionsHint("unauthorized")).toContain(
      "whatever your role is",
    );
  });

  it("sorts the slugs, so the same login always reads the same way", () => {
    loginWith(["trace:view", "project:view"]);

    expect(loginPermissionsHint("unauthorized")).toContain(
      "project:view, trace:view",
    );
  });

  /** @scenario "a login that recorded no permissions adds nothing" */
  it("adds nothing when the login recorded no permissions", () => {
    loginWith(undefined);

    expect(loginPermissionsHint("unauthorized")).toBeUndefined();
  });

  it("adds nothing when there is no login on this machine", () => {
    config.load.mockReturnValue(undefined);

    expect(loginPermissionsHint("unauthorized")).toBeUndefined();
  });

  it("adds nothing rather than failing twice when the config cannot be read", () => {
    config.load.mockImplementation(() => {
      throw new Error("unreadable");
    });

    expect(loginPermissionsHint("unauthorized")).toBeUndefined();
  });
});

describe("given a failure that is not an authorization one", () => {
  /** @scenario "a failure that is not an authorization one is left alone" */
  it("adds no permissions line", () => {
    loginWith(["project:view"]);

    expect(loginPermissionsHint("not_found")).toBeUndefined();
    expect(loginPermissionsHint("validation_error")).toBeUndefined();
  });
});
