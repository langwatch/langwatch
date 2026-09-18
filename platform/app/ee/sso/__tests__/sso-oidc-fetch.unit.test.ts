import type { Agent } from "undici";
import { describe, expect, it, vi } from "vitest";
import { createSsoOidcFetch, type OidcTransport } from "../sso-oidc-fetch";

const issuer = "https://registered-idp.example.test";

describe("runtime OIDC egress", () => {
  /** @scenario "Runtime OIDC requests enforce the public-address policy independently of browser trust" */
  it.each([
    ["127.0.0.1"],
    ["10.0.0.1"],
    ["169.254.169.254"],
    ["::1"],
    ["::ffff:127.0.0.1"],
    ["93.184.216.34", "10.0.0.1"],
    [],
  ])(
    "refuses nonpublic or empty DNS answers %j before transport",
    async (...addresses) => {
      const fetchImpl = vi.fn(async () => Response.json({}));
      const fetch = createSsoOidcFetch({
        dialableInternalOrigins: [],
        resolveHost: async () => addresses,
        fetchImpl,
      });
      await expect(fetch(`${issuer}/token`)).rejects.toThrow(
        "oidc endpoint refused by egress policy",
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("fails closed on DNS failure", async () => {
    const fetchImpl = vi.fn(async () => Response.json({}));
    const fetch = createSsoOidcFetch({
      dialableInternalOrigins: [],
      resolveHost: async () => {
        throw new Error("dns unavailable");
      },
      fetchImpl,
    });
    await expect(fetch(`${issuer}/jwks`)).rejects.toThrow(
      "oidc endpoint refused by egress policy",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks DNS again on every request after an initially public answer", async () => {
    const resolveHost = vi
      .fn()
      .mockResolvedValueOnce(["93.184.216.34"])
      .mockResolvedValueOnce(["127.0.0.1"]);
    const fetchImpl = vi.fn(async () => Response.json({}));
    const fetch = createSsoOidcFetch({
      dialableInternalOrigins: [],
      resolveHost,
      fetchImpl,
    });
    await expect(fetch(`${issuer}/discovery`)).resolves.toMatchObject({
      status: 200,
    });
    await expect(fetch(`${issuer}/token`)).rejects.toThrow(
      "oidc endpoint refused by egress policy",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("only exempts origins explicitly allowed by the operator", async () => {
    const fetchImpl = vi.fn(async () => Response.json({}));
    const fetch = createSsoOidcFetch({
      dialableInternalOrigins: [issuer],
      resolveHost: async () => ["10.0.0.1"],
      fetchImpl,
    });
    await expect(fetch(`${issuer}/token`)).resolves.toMatchObject({
      status: 200,
    });
    await expect(
      fetch("https://another-idp.example.test/token"),
    ).rejects.toThrow("oidc endpoint refused by egress policy");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses redirects without sending a second request", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/metadata" },
        }),
    );
    const fetch = createSsoOidcFetch({
      dialableInternalOrigins: [],
      resolveHost: async () => ["93.184.216.34"],
      fetchImpl,
    });
    await expect(fetch(`${issuer}/token`)).rejects.toThrow(
      "oidc endpoint redirects are refused",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${issuer}/token`,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("preserves token exchange bytes and closes its pinned dispatcher", async () => {
    const fetchImpl = vi.fn<OidcTransport>(async (_url, init) => {
      expect(new TextDecoder().decode(init.body)).toBe("code=verified-code");
      expect(init.headers.authorization).toBe("Basic client-credentials");
      expect(init.method).toBe("POST");
      expect(init.dispatcher.destroyed).toBe(false);
      return Response.json({ access_token: "token" });
    });
    const fetch = createSsoOidcFetch({
      dialableInternalOrigins: [],
      resolveHost: async () => ["93.184.216.34"],
      fetchImpl,
    });
    const response = await fetch(`${issuer}/token`, {
      method: "POST",
      body: "code=verified-code",
      headers: { authorization: "Basic client-credentials" },
    });
    expect(await response.json()).toEqual({ access_token: "token" });
    expect(fetchImpl.mock.calls[0]?.[1].dispatcher.destroyed).toBe(true);
  });
  it.each(["transport", "body"])(
    "closes the pinned dispatcher after a %s failure",
    async (failure) => {
      const dispatchers: Agent[] = [];
      const fetchImpl = vi.fn<OidcTransport>(async (_url, init) => {
        dispatchers.push(init.dispatcher);
        if (failure === "transport") throw new Error("upstream failed");
        return {
          status: 200,
          statusText: "OK",
          headers: [],
          arrayBuffer: async () => {
            throw new Error("upstream failed");
          },
        };
      });
      const fetch = createSsoOidcFetch({
        dialableInternalOrigins: [],
        resolveHost: async () => ["93.184.216.34"],
        fetchImpl,
      });
      await expect(fetch(`${issuer}/jwks`)).rejects.toThrow("upstream failed");
      expect(dispatchers).toHaveLength(1);
      expect(dispatchers[0]?.destroyed).toBe(true);
    },
  );
});
