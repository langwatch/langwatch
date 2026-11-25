import http from "node:http";
import net, { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

const pgCalls: { connectionString?: string; query?: string }[] = [];
let pgFailure: Error | null = null;

vi.mock("pg", () => ({
  default: {
    Client: class {
      constructor(private readonly config: { connectionString: string }) {}
      async connect() {
        pgCalls.push({ connectionString: this.config.connectionString });
        if (pgFailure) throw pgFailure;
      }
      async query(text: string) {
        pgCalls.push({ query: text });
      }
      async end() {}
    },
  },
}));

const { probeDatabase } = await import("../../src/services/database-probe.ts");

const closers: (() => void)[] = [];

afterEach(() => {
  pgCalls.length = 0;
  pgFailure = null;
  for (const close of closers.splice(0)) close();
});

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => {
    if (server instanceof http.Server) server.closeAllConnections();
    server.close();
  });
  return (server.address() as AddressInfo).port;
}

/** Redis' wire format (RESP), read back into each command's words. */
function parseCommands(text: string): string[][] {
  const lines = text.split("\r\n");
  const parsed: string[][] = [];
  let index = 0;
  while (lines[index]?.startsWith("*")) {
    const count = Number(lines[index]?.slice(1));
    const block = lines.slice(index + 1, index + 1 + count * 2);
    parsed.push(block.filter((_line, position) => position % 2 === 1));
    index += 1 + count * 2;
  }
  return parsed;
}

function replyTo({ words, password }: { words: string[]; password?: string }): string {
  const [name] = words;
  if (name === "PING") return "+PONG\r\n";
  const isAccepted = words.at(-1) === password;
  return isAccepted ? "+OK\r\n" : "-WRONGPASS bad\r\n";
}

describe("connecting to a database the person brings", () => {
  describe("when it is Postgres", () => {
    /** @scenario "A database they bring is connected before it is saved" */
    it("connects with the URL and runs one query, and names the reason a connect fails", async () => {
      const url = "postgresql://me@db.internal:5432/langwatch";

      expect(await probeDatabase({ id: "postgres", url })).toEqual({ ok: true });
      expect(pgCalls).toEqual([{ connectionString: url }, { query: "select 1" }]);

      pgFailure = new Error('password authentication failed for user "me"');
      expect(await probeDatabase({ id: "postgres", url })).toEqual({
        ok: false,
        reason: 'password authentication failed for user "me"',
      });
    });
  });

  describe("when it is Redis", () => {
    /** A stub Redis: every command it was sent, as words; AUTH takes only `password`. */
    function stubRedis({ password }: { password?: string } = {}) {
      const commands: string[][] = [];
      const server = net.createServer((socket) => {
        socket.on("error", () => undefined);
        socket.on("data", (chunk) => {
          for (const words of parseCommands(chunk.toString())) {
            commands.push(words);
            socket.write(replyTo({ words, password }));
          }
        });
      });
      return { server, commands };
    }

    /** @scenario "A database they bring is connected before it is saved" */
    it("sends PING over the socket and accepts PONG", async () => {
      const { server, commands } = stubRedis();
      const port = await listen(server);

      expect(await probeDatabase({ id: "redis", url: `redis://127.0.0.1:${port}/0` })).toEqual({
        ok: true,
      });
      expect(commands.flat()).toEqual(["PING"]);
    });

    /** @scenario "A database they bring is connected before it is saved" */
    it("sends AUTH with the URL's user and password first, and names a refusal", async () => {
      const { server, commands } = stubRedis({ password: "s3cret" });
      const port = await listen(server);

      const accepted = await probeDatabase({
        id: "redis",
        url: `redis://me:s3cret@127.0.0.1:${port}/0`,
      });
      const refused = await probeDatabase({ id: "redis", url: `redis://:wrong@127.0.0.1:${port}` });

      expect(accepted).toEqual({ ok: true });
      expect(commands.flat().slice(0, 4)).toEqual(["AUTH", "me", "s3cret", "PING"]);
      expect(refused).toEqual({ ok: false, reason: "WRONGPASS bad" });
    });
  });

  describe("when it is ClickHouse", () => {
    const SELECT_ONE = "/?database=langwatch&query=SELECT+1";
    /** @scenario "A database they bring is connected before it is saved" */
    it("runs SELECT 1 and refuses a server that does not answer 1", async () => {
      const server = http.createServer((req, res) => {
        res.end(req.url === SELECT_ONE ? "1\n" : "no");
      });
      const port = await listen(server);
      const refusing = http.createServer((_req, res) => {
        res.writeHead(516).end("Authentication failed");
      });
      const refusingPort = await listen(refusing);

      expect(
        await probeDatabase({ id: "clickhouse", url: `http://127.0.0.1:${port}/langwatch` }),
      ).toEqual({ ok: true });
      expect(
        await probeDatabase({ id: "clickhouse", url: `http://127.0.0.1:${refusingPort}/x` }),
      ).toEqual({ ok: false, reason: "SELECT 1 answered 516: Authentication failed" });
    });

    /** @scenario "A database they bring is connected before it is saved" */
    it("runs SELECT 1 in the URL path's database and names a database that does not exist", async () => {
      const server = http.createServer((req, res) => {
        const database = new URL(req.url ?? "/", "http://probe").searchParams.get("database");
        if (database === "langwatch") res.end("1\n");
        else res.writeHead(404).end(`Code: 81. Database ${database} does not exist`);
      });
      const port = await listen(server);

      expect(
        await probeDatabase({ id: "clickhouse", url: `http://127.0.0.1:${port}/langwatch` }),
      ).toEqual({ ok: true });
      expect(
        await probeDatabase({ id: "clickhouse", url: `http://127.0.0.1:${port}/missing` }),
      ).toEqual({
        ok: false,
        reason: "SELECT 1 answered 404: Code: 81. Database missing does not exist",
      });
    });

    /** @scenario "A database password is never shown" */
    it("sends the URL's user and password as Basic auth, not in the URL", async () => {
      const seen: { url?: string; authorization?: string }[] = [];
      const server = http.createServer((req, res) => {
        seen.push({ url: req.url, authorization: req.headers.authorization });
        res.end("1\n");
      });
      const port = await listen(server);

      const result = await probeDatabase({
        id: "clickhouse",
        url: `http://me:s%40cret@127.0.0.1:${port}/langwatch`,
      });

      expect(result).toEqual({ ok: true });
      expect(seen).toEqual([
        { url: SELECT_ONE, authorization: `Basic ${Buffer.from("me:s@cret").toString("base64")}` },
      ]);
    });
  });

  describe("when a driver's reason repeats the URL or its password", () => {
    /** @scenario "A database password is never shown" */
    it("shows the reason with the password replaced", async () => {
      const url = "postgresql://me:s3cret@db.internal:5432/langwatch";
      pgFailure = new Error(`could not reach ${url} (password s3cret)`);

      expect(await probeDatabase({ id: "postgres", url })).toEqual({
        ok: false,
        reason: "could not reach postgresql://me:***@db.internal:5432/langwatch (password ***)",
      });
    });
  });
});
