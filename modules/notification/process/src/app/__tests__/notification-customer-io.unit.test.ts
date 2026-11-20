/** Spec: modules/notification/specs/customer-io-transactional.feature */
import { mailTemplates } from "@langwatch/mail";
import type { NotificationServerConfig } from "@langwatch/notification-contract";
import { ResourceScope } from "@langwatch/process";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import type * as TestHarness from "@langwatch/test-harness";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { EnvHttpProxyAgent, fetch, captured } = vi.hoisted(() => ({
  EnvHttpProxyAgent: vi.fn(),
  fetch: vi.fn(),
  captured: { lines: [] as { level: number; msg?: string; [field: string]: unknown }[] },
}));

// The network stops at undici: Customer.io and Resend (the own mailer here) are both recorded.
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  EnvHttpProxyAgent,
  fetch,
}));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const harness = await vi.importActual<typeof TestHarness>("@langwatch/test-harness");
  const { logger, lines } = harness.createTestLogger();
  captured.lines = lines;
  return { ...(await importOriginal<object>()), createLogger: () => logger };
});

import { MemoryNotificationRepositories } from "../../repositories/memory/memory.notification.repositories.ts";
import { NotificationModule } from "../notification.app.ts";

const CUSTOMER_IO_KEY = "cio_app_secret_key";
const RECIPIENT = "ada@acme.test";

const ROUTED = [
  "invite-re-request",
  "join-request-arrived",
  "join-request-reminder",
  "join-request-approved",
  "join-request-rejected",
  "join-request-expired",
  "domain-auto-joined",
  "seat-request",
  "usage-limit",
  "payment-recovery",
  "budget-increase-request",
  "automation-limit",
  "trigger-digest",
  "monitor-auto-paused",
];

function config({ isSaas }: { isSaas: boolean }): NotificationServerConfig {
  return {
    defaultFrom: "LangWatch <contact@langwatch.test>",
    provider: "resend",
    ses: { enabled: undefined, region: undefined, endpoint: undefined },
    smtp: { host: undefined, port: undefined, user: undefined, secure: undefined },
    publicBaseUrl: "https://app.langwatch.test",
    webPushServiceBase: undefined,
    isSaas,
    customerIoRegion: undefined,
    outboundProxy: {
      HTTPS_PROXY: undefined,
      https_proxy: undefined,
      HTTP_PROXY: undefined,
      http_proxy: undefined,
      NO_PROXY: undefined,
      no_proxy: undefined,
    },
  };
}

/** The notification app with Resend as its own mailer, on Cloud or not, holding the key or not. */
function notificationApp({ isSaas, withKey }: { isSaas: boolean; withKey: boolean }) {
  const environment = {
    RESEND_API_KEY: "re_test",
    ...(withKey ? { CUSTOMER_IO_APP_API_KEY: CUSTOMER_IO_KEY } : {}),
  };
  const secrets = SecretsResolver.over(SecretsChain.start({ environment }).withEnv()).scopeTo(
    "notification",
    Object.values(NotificationModule.secrets),
  );
  return NotificationModule.create({
    repositories: MemoryNotificationRepositories.create(),
    dependencies: {},
    config: config({ isSaas }),
    resources: new ResourceScope(),
    secrets,
  });
}

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

const sent = (): Sent[] =>
  fetch.mock.calls.map(([url, init]) => {
    const { headers, body } = init as { headers: Record<string, string>; body: string };
    return { url: String(url), headers, body: JSON.parse(body) as Record<string, unknown> };
  });
const toCustomerIo = () => sent().filter(({ url }) => url.includes("customer.io"));
const toOwnMailer = () => sent().filter(({ url }) => url.includes("resend.com"));

const message = (template?: string) => ({
  to: RECIPIENT,
  subject: "Subject line",
  html: "<p>Rendered here</p>",
  ...(template === undefined ? {} : { template }),
});

beforeEach(() => {
  vi.clearAllMocks();
  captured.lines.length = 0;
  fetch.mockImplementation(async (url: string) =>
    String(url).includes("customer.io")
      ? { ok: true, status: 200, json: async () => ({ delivery_id: "dlv_1" }) }
      : { ok: true, status: 200, json: async () => ({ id: "re_1" }) },
  );
});

describe("given LangWatch Cloud holding the Customer.io key", () => {
  describe.each(ROUTED)("when a %s message is sent", (template) => {
    /** @scenario "A routed template goes through Customer.io on Cloud" */
    it("hands exactly one request to Customer.io's EU endpoint and none to the own mailer", async () => {
      const app = await notificationApp({ isSaas: true, withKey: true });

      await app.sendEmail(message(template));

      const [request, ...more] = toCustomerIo();
      expect(more).toEqual([]);
      expect(request?.url).toBe("https://api-eu.customer.io/v1/send/email");
      expect(request?.headers.Authorization).toBe(`Bearer ${CUSTOMER_IO_KEY}`);
      expect(request?.body).toMatchObject({
        transactional_message_id: template,
        to: RECIPIENT,
        subject: "Subject line",
        body: "<p>Rendered here</p>",
        tracked: false,
      });
      expect(toOwnMailer()).toEqual([]);
    });
  });

  const others: [string, string | undefined][] = [
    ...mailTemplates
      .map(({ id }) => id)
      .filter((id) => !ROUTED.includes(id))
      .map((id): [string, string] => [id, id]),
    ["no template", undefined],
  ];

  describe.each(others)("when a message of %s is sent", (_name, template) => {
    /** @scenario "Every other message stays on the own mailer on Cloud" */
    it("sends it through the own mailer and nothing to Customer.io", async () => {
      const app = await notificationApp({ isSaas: true, withKey: true });

      await app.sendEmail(message(template));

      expect(toCustomerIo()).toEqual([]);
      expect(toOwnMailer()).toHaveLength(1);
    });
  });
});

describe.each([
  ["IS_SAAS is unset", { isSaas: false, withKey: true }],
  ["the key is missing", { isSaas: true, withKey: false }],
])("given %s", (_name, deployment) => {
  describe("when a payment-recovery message is sent", () => {
    /** @scenario "Without IS_SAAS or the key nothing reaches Customer.io" */
    it("sends it through the own mailer and nothing to Customer.io", async () => {
      const app = await notificationApp(deployment);

      await app.sendEmail(message("payment-recovery"));

      expect(toCustomerIo()).toEqual([]);
      expect(toOwnMailer()).toHaveLength(1);
    });
  });
});

describe("given LangWatch Cloud holding the Customer.io key", () => {
  describe("when one routed send is accepted and one is refused and falls back", () => {
    /** @scenario "No log line carries the key or a recipient address" */
    it("logs neither the key nor the recipient", async () => {
      const app = await notificationApp({ isSaas: true, withKey: true });
      await app.sendEmail(message("payment-recovery"));
      fetch.mockImplementation(async (url: string) =>
        String(url).includes("customer.io")
          ? { ok: false, status: 500, body: { cancel: async () => undefined } }
          : { ok: true, status: 200, json: async () => ({ id: "re_2" }) },
      );

      await app.sendEmail(message("payment-recovery"));

      expect(toOwnMailer()).toHaveLength(1);
      expect(captured.lines.length).toBeGreaterThan(0);
      const logged = JSON.stringify(captured.lines);
      expect(logged).not.toContain(CUSTOMER_IO_KEY);
      expect(logged).not.toContain(RECIPIENT);
    });
  });
});
