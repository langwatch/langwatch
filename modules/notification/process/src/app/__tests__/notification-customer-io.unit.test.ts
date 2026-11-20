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

// The own mailer here is Resend, so the network stops at undici and its sends are recorded.
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

import { MemoryCustomerIoMailChannel } from "../../channels/memory/memory.customer-io-mail.channel.ts";
import { MemoryNotificationRepositories } from "../../repositories/memory/memory.notification.repositories.ts";
import { NotificationModule } from "../notification.app.ts";

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

/**
 * The notification app with Resend as its own mailer, on Cloud or not. `customerIo` stands in for
 * nurturing's answer: it queues, or answers `off` as nurturing does without the App API key.
 */
async function notificationApp({ isSaas, keyed = true }: { isSaas: boolean; keyed?: boolean }) {
  const customerIo = MemoryCustomerIoMailChannel.create();
  if (!keyed) customerIo.turnOff();
  const secrets = SecretsResolver.over(
    SecretsChain.start({ environment: { RESEND_API_KEY: "re_test" } }).withEnv(),
  ).scopeTo("notification", Object.values(NotificationModule.secrets));
  const app = await NotificationModule.create({
    repositories: MemoryNotificationRepositories.create(),
    dependencies: {},
    config: config({ isSaas }),
    channels: { customerIoMail: customerIo },
    resources: new ResourceScope(),
    secrets,
  });
  return { app, customerIo };
}

const toOwnMailer = () =>
  fetch.mock.calls.filter(([url]) => String(url).includes("resend.com")).map(([, init]) => init);

const message = (template?: string) => ({
  to: RECIPIENT,
  subject: "Subject line",
  html: "<p>Rendered here</p>",
  ...(template === undefined ? {} : { template }),
});

beforeEach(() => {
  vi.clearAllMocks();
  captured.lines.length = 0;
  fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "re_1" }) });
});

describe("given LangWatch Cloud with nurturing holding the Customer.io key", () => {
  describe.each(ROUTED)("when a %s message is sent", (template) => {
    /** @scenario "A routed template goes through Customer.io on Cloud" */
    it("hands exactly one message to Customer.io and none to the own mailer", async () => {
      const { app, customerIo } = await notificationApp({ isSaas: true });

      await app.sendEmail(message(template));

      expect(customerIo.sent).toEqual([
        {
          transactionalMessageId: template,
          identifiers: { email: RECIPIENT },
          to: RECIPIENT,
          from: "LangWatch <contact@langwatch.test>",
          subject: "Subject line",
          body: "<p>Rendered here</p>",
        },
      ]);
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
      const { app, customerIo } = await notificationApp({ isSaas: true });

      await app.sendEmail(message(template));

      expect(customerIo.sent).toEqual([]);
      expect(toOwnMailer()).toHaveLength(1);
    });
  });
});

describe.each([
  ["IS_SAAS is unset", { isSaas: false }],
  ["nurturing holds no Customer.io key", { isSaas: true, keyed: false }],
])("given %s", (_name, deployment) => {
  describe("when a usage-limit message is sent", () => {
    /** @scenario "Without IS_SAAS or the key nothing reaches Customer.io" */
    it("sends it through the own mailer and nothing to Customer.io", async () => {
      const { app, customerIo } = await notificationApp(deployment);

      await app.sendEmail(message("usage-limit"));

      expect(customerIo.sent).toEqual([]);
      expect(toOwnMailer()).toHaveLength(1);
      expect(captured.lines.filter((line) => line.level >= 40)).toEqual([]);
    });
  });
});

describe("given LangWatch Cloud with nurturing holding the Customer.io key", () => {
  describe("when one routed send is accepted and one is refused and falls back", () => {
    /** @scenario "No log line carries the key or a recipient address" */
    it("logs no recipient address", async () => {
      const { app, customerIo } = await notificationApp({ isSaas: true });
      await app.sendEmail(message("usage-limit"));
      customerIo.refuse({ outcome: "refused", reason: "status", status: 500 });

      await app.sendEmail(message("usage-limit"));

      expect(toOwnMailer()).toHaveLength(1);
      expect(captured.lines.length).toBeGreaterThan(0);
      expect(JSON.stringify(captured.lines)).not.toContain(RECIPIENT);
    });
  });
});
