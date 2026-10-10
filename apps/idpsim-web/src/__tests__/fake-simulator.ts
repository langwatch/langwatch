import { vi } from "vitest";

/** One canned answer per "METHOD path", and the requests the page sent. */
export const fakeSimulator = ({
  routes,
}: {
  routes: Record<string, { status?: number; body: unknown }>;
}) => {
  const sent: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      sent.push({ method, path: input, body });
      const route = routes[`${method} ${input}`];
      if (route === undefined) return new Response("", { status: 404 });
      return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
    }),
  );
  return { sent };
};

export const tenantOne = {
  id: 1,
  domain: "acme1.test",
  baseUrl: "http://idp.test/t/1",
  rootUrl: "http://idp.test",
  dnsAddr: "127.0.0.1:15353",
  scimToken: "idpsim-scim-token-1",
  saml: {
    signInUrl: "http://idp.test/t/1/saml/sso",
    entityId: "http://idp.test/t/1/saml/metadata",
    metadataUrl: "http://idp.test/t/1/saml/metadata",
    certificate: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
  },
  applications: null,
  users: [
    {
      id: "t1-user-admin",
      userName: "admin@acme1.test",
      email: "admin@acme1.test",
      givenName: "Ada",
      familyName: "Admin",
      active: true,
      groups: ["Everyone"],
    },
  ],
  records: null,
  provisioning: { configured: false, baseUrl: "", token: "••••••••" },
  lastProvisioning: null,
  scale: { users: 500, groups: 6, last: "" },
};
