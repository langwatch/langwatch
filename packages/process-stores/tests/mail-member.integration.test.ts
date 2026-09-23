import { once } from "node:events";
import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createProcessMembers } from "../src/create-members.ts";
import type { ProcessConfig } from "../src/index.ts";

/** A relay that speaks just enough SMTP to accept one message, and records it. */
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
            socket.write("250 queued\r\n");
          } else data += `${line}\n`;
        } else if (/^EHLO/i.test(line)) socket.write("250-relay.test\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH/i.test(line)) socket.write("235 accepted\r\n");
        else if (/^DATA/i.test(line)) {
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

let relay: Awaited<ReturnType<typeof startRelay>> | undefined;
afterEach(() => relay?.server.close());

describe("given a process started with an SMTP gateway", () => {
  describe("when a module reads mail and sends", () => {
    it("delivers through the provider to the relay rather than skipping", async () => {
      relay = await startRelay();
      const config: ProcessConfig = {
        processName: "test",
        encryptionKey: Buffer.alloc(32, 7).toString("hex"),
        secrets: {},
        rateLimit: { requests: 10, seconds: 60 },
        mail: {
          provider: "smtp",
          defaultFrom: "LangWatch <contact@langwatch.test>",
          host: "127.0.0.1",
          port: relay.port,
          user: "u",
          password: "p",
          secure: false,
        },
      };
      const members = createProcessMembers({ config });

      await members.read("mail").send({
        to: "ada@example.com",
        subject: "Trigger - Errors above threshold",
        html: "<p>hi</p>",
      });
      await members.close();

      expect(relay.received).toHaveLength(1);
      expect(relay.received[0]).toContain("Subject: Trigger - Errors above threshold");
      expect(relay.received[0]).toContain("To: ada@example.com");
    });
  });
});
