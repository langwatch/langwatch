import { once } from "node:events";
import { createServer, type Server, type Socket } from "node:net";

import { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { afterEach, describe, expect, it } from "vitest";

import { notificationProcessModule } from "../../notification.module.ts";

/** A relay that speaks just enough SMTP to accept messages, recording each with its envelope. */
async function startRelay(): Promise<{ server: Server; port: number; received: string[] }> {
  const received: string[] = [];
  const server = createServer((socket: Socket) => {
    let inData = false;
    let data = "";
    socket.write("220 relay.test ESMTP\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").split("\r\n").slice(0, -1)) {
        if (inData) {
          if (line === ".") {
            inData = false;
            received.push(data);
            data = "";
            socket.write("250 queued\r\n");
          } else data += `${line}\n`;
        } else if (/^EHLO/i.test(line)) socket.write("250-relay.test\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH/i.test(line)) socket.write("235 accepted\r\n");
        else if (/^RCPT TO/i.test(line)) {
          data += `${line}\n`;
          socket.write("250 ok\r\n");
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The relay has no port.");

  return { server, port: address.port, received };
}

function process(smtp: { host: string | undefined; port: string | undefined; provider?: string }) {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { SMTP_PASSWORD: "p" } }).withEnv(),
  );
  return createApp({
    role: "worker",
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
  })
    .withModules([withMemoryRepositories(notificationProcessModule)])
    .withMember("publicBaseUrl", "https://app.langwatch.test")
    .withMember("outboundProxy", {})
    .withConfig({
      notification: {
        defaultFrom: "LangWatch <contact@langwatch.test>",
        provider: smtp.provider,
        ses: { enabled: undefined, region: undefined, endpoint: undefined },
        smtp: { host: smtp.host, port: smtp.port, user: "u", secure: "false" },
      },
    });
}

let relay: Awaited<ReturnType<typeof startRelay>> | undefined;
afterEach(() => relay?.server.close());

describe("given a process composed with an SMTP gateway", () => {
  describe("when a module sends through NotificationApi", () => {
    it("delivers to the relay, hiding undisclosed recipients and writing the one-click pair", async () => {
      relay = await startRelay();
      const runtime = await process({
        host: "127.0.0.1",
        port: String(relay.port),
        provider: "smtp",
      }).boot();

      try {
        await runtime.service(NotificationApi).sendEmail({
          to: "LangWatch Triggers <no-reply+tag@langwatch.test>",
          undisclosedRecipients: ["ada@example.com"],
          subject: "Trigger - Errors above threshold",
          html: "<p>hi</p>",
          unsubscribe: { url: "https://app.langwatch.test/api/unsubscribe?token=t" },
        });
      } finally {
        await runtime.stop();
      }

      expect(relay.received).toHaveLength(1);
      const message = relay.received[0] ?? "";
      expect(message).toContain("Subject: Trigger - Errors above threshold");
      expect(message).toContain("From: LangWatch <contact@langwatch.test>");
      expect(message).toContain("RCPT TO:<ada@example.com>");
      expect(message).not.toMatch(/^(To|Cc|Bcc):.*ada@example\.com/m);
      expect(message).toContain(
        "List-Unsubscribe: <https://app.langwatch.test/api/unsubscribe?token=t>",
      );
      expect(message).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    });
  });
});

describe("given a process composed with no mail gateway", () => {
  describe("when a module sends through NotificationApi", () => {
    it("boots and skips the send rather than failing it", async () => {
      const runtime = await process({ host: undefined, port: undefined }).boot();

      try {
        await expect(
          runtime.service(NotificationApi).sendEmail({
            to: "ada@example.com",
            subject: "Reset your password",
            html: "<p>hi</p>",
          }),
        ).resolves.toBeUndefined();
      } finally {
        await runtime.stop();
      }
    });
  });
});
