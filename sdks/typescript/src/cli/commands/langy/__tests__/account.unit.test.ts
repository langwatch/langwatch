/**
 * Whether the terminal's login is the person who asked Langy, over a real
 * login file and a scripted question.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type prompts from "prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { matchAskerAccount, nothingYetMessage, signedInPerson } from "../account";
import { ensureSignedIn } from "../requests";

const ENDPOINT = "https://app.langwatch.test";
const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (text: string): string => text.replace(ANSI_SEQUENCE, "");

describe("given a login on this machine as riley@acme.test", () => {
  let dir: string;
  let configPath: string;
  let printed: string[];
  const before = {
    config: process.env.LANGWATCH_CLI_CONFIG,
    endpoint: process.env.LANGWATCH_ENDPOINT,
  };

  const writeLogin = ({ email, key }: { email?: string; key: string }): void => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        gateway_url: ENDPOINT,
        control_plane_url: ENDPOINT,
        access_token: "session-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        cli_api_key: key,
        user: email ? { id: `user_${email}`, email, name: email.split("@")[0] } : { id: "user_1" },
        organization: { id: "org_1", slug: "acme", name: "ACME" },
      }),
    );
  };

  /** The question, answered from a script; records what it was asked. */
  const answering = (answer: boolean | undefined) => {
    const asked: string[] = [];
    const ask = (async (question: { message: string }) => {
      asked.push(question.message);
      return answer === undefined ? {} : { switch: answer };
    }) as unknown as typeof prompts;
    return { ask, asked };
  };

  const print = (line: string): void => {
    printed.push(stripAnsi(line));
  };

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "langy-account-")));
    configPath = path.join(dir, "config.json");
    process.env.LANGWATCH_CLI_CONFIG = configPath;
    process.env.LANGWATCH_ENDPOINT = ENDPOINT;
    writeLogin({ email: "riley@acme.test", key: "sk-lw-riley-key" });
    printed = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [name, value] of [
      ["LANGWATCH_CLI_CONFIG", before.config],
      ["LANGWATCH_ENDPOINT", before.endpoint],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("when the request came from sam@acme.test and I answer yes", () => {
    /** @scenario "A login that is not the asker's offers to sign in as the asker" */
    it("names both people, asks, signs in, and the new login's key is the one used", async () => {
      const { ask, asked } = answering(true);
      const signIn = vi.fn(async () => {
        writeLogin({ email: "sam@acme.test", key: "sk-lw-sam-key" });
      });

      const outcome = await matchAskerAccount({
        askedBy: "sam@acme.test",
        signIn,
        ask,
        interactive: true,
        print,
      });

      expect(printed).toContain(
        "Signed in as riley@acme.test, the request came from sam@acme.test.",
      );
      expect(asked).toEqual(["Sign in as sam@acme.test?"]);
      expect(signIn).toHaveBeenCalledTimes(1);
      expect(outcome).toBe("switched");
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const credentials = await ensureSignedIn({ login: vi.fn() });
      expect(credentials.apiKey).toBe("sk-lw-sam-key");
    });

    /** @scenario "A sign-in that lands on the same login says so and keeps waiting" */
    it("says it is still signed in as riley when the browser approved as riley again", async () => {
      const { ask } = answering(true);
      const signIn = vi.fn(async () => {
        writeLogin({ email: "riley@acme.test", key: "sk-lw-riley-key-2" });
      });

      const outcome = await matchAskerAccount({
        askedBy: "sam@acme.test",
        signIn,
        ask,
        interactive: true,
        print,
      });

      expect(outcome).toBe("switched");
      expect(printed).toContain("Still signed in as riley@acme.test, not sam@acme.test.");
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const credentials = await ensureSignedIn({ login: vi.fn() });
      expect(credentials.apiKey).toBe("sk-lw-riley-key-2");
    });

    /** @scenario "A sign-in that lands on a third login names it and waits with it" */
    it("names jo as the new login when the browser approved as jo", async () => {
      const { ask } = answering(true);
      const signIn = vi.fn(async () => {
        writeLogin({ email: "jo@acme.test", key: "sk-lw-jo-key" });
      });

      const outcome = await matchAskerAccount({
        askedBy: "sam@acme.test",
        signIn,
        ask,
        interactive: true,
        print,
      });

      expect(outcome).toBe("switched");
      expect(printed).toContain("Now signed in as jo@acme.test, not sam@acme.test.");
      expect(printed.join("\n")).toContain("approve as sam@acme.test");
    });

    /** @scenario "A sign-in that fails after saving a login names the saved login" */
    it("names the saved login, and reloads it, when the sign-in fails after saving", async () => {
      const { ask } = answering(true);
      const signIn = vi.fn(async () => {
        writeLogin({ email: "sam@acme.test", key: "sk-lw-sam-key" });
        throw new Error("the bootstrap request failed");
      });

      const outcome = await matchAskerAccount({
        askedBy: "sam@acme.test",
        signIn,
        ask,
        interactive: true,
        print,
      });

      expect(outcome).toBe("switched");
      expect(printed).toContain(
        "Could not finish signing in as sam@acme.test (the bootstrap request failed). Now signed in as sam@acme.test.",
      );
    });

    it("keeps the login, with the reason, when the sign-in fails", async () => {
      const { ask } = answering(true);
      const signIn = vi.fn(async () => {
        throw new Error("the browser approval timed out");
      });

      const outcome = await matchAskerAccount({
        askedBy: "sam@acme.test",
        signIn,
        ask,
        interactive: true,
        print,
      });

      expect(outcome).toBe("kept");
      expect(printed.join("\n")).toContain("the browser approval timed out");
      expect(printed.join("\n")).toContain("Staying signed in as riley@acme.test.");
    });
  });

  describe("when the request came from sam@acme.test and I answer no", () => {
    /** @scenario "Keeping the other login keeps waiting" */
    it("runs no sign-in and says sam's requests do not reach this terminal", async () => {
      const { ask } = answering(false);
      const signIn = vi.fn();

      const outcome = await matchAskerAccount({
        askedBy: "sam@acme.test",
        signIn,
        ask,
        interactive: true,
        print,
      });

      expect(outcome).toBe("kept");
      expect(signIn).not.toHaveBeenCalled();
      expect(printed).toContain(
        "Staying signed in as riley@acme.test. Requests made by sam@acme.test do not reach this terminal.",
      );
    });
  });

  describe("when the request came from riley, spelled in another case", () => {
    /** @scenario "The asker's own login asks nothing" */
    it("asks nothing and prints nothing", async () => {
      const { ask, asked } = answering(true);

      const outcome = await matchAskerAccount({
        askedBy: " Riley@ACME.test ",
        signIn: vi.fn(),
        ask,
        interactive: true,
        print,
      });

      expect(outcome).toBe("same");
      expect(asked).toEqual([]);
      expect(printed).toEqual([]);
    });
  });

  describe("when the login recorded no email", () => {
    /** @scenario "A login that recorded no email asks nothing" */
    it("asks nothing and prints nothing, since there is nothing to compare", async () => {
      writeLogin({ key: "sk-lw-riley-key" });
      const { ask, asked } = answering(true);
      const signIn = vi.fn();

      const outcome = await matchAskerAccount({
        askedBy: "sam@acme.test",
        signIn,
        ask,
        interactive: true,
        print,
      });

      expect(outcome).toBe("unknown");
      expect(asked).toEqual([]);
      expect(signIn).not.toHaveBeenCalled();
      expect(printed).toEqual([]);
      expect(nothingYetMessage({ person: signedInPerson() })[0]).toBe(
        "No Langy request has reached this login at ACME yet.",
      );
    });
  });

  describe("when the input is not a terminal", () => {
    /** @scenario "Output that is not a terminal says how to switch instead of asking" */
    it("prints the mismatch and what to run, and asks nothing", async () => {
      const { ask, asked } = answering(true);
      const signIn = vi.fn();

      const outcome = await matchAskerAccount({
        askedBy: "sam@acme.test",
        signIn,
        ask,
        interactive: false,
        print,
      });

      expect(outcome).toBe("kept");
      expect(asked).toEqual([]);
      expect(signIn).not.toHaveBeenCalled();
      expect(printed).toContain(
        "Signed in as riley@acme.test, the request came from sam@acme.test.",
      );
      expect(printed.join("\n")).toContain(
        "run `langwatch login --device` and approve as sam@acme.test",
      );
    });
  });

  describe("when nothing has arrived for a while", () => {
    /** @scenario "Nothing arriving for thirty seconds names the login and how to switch" */
    it("names the login and its organization, and how to switch", () => {
      const [line, hint] = nothingYetMessage({ person: signedInPerson() });

      expect(line).toBe("No Langy request has reached riley@acme.test at ACME yet.");
      expect(hint).toContain("`langwatch login --device`");
    });
  });
});
