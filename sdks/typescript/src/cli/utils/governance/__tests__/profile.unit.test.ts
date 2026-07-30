import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath } from "../config";
import {
  assertValidProfileName,
  DEFAULT_PROFILE,
  InvalidProfileNameError,
  isSoloProfile,
  profileConfigPath,
  resolveProfileName,
  soloProfileName,
} from "../profile";

const ENV_KEYS = ["LANGWATCH_PROFILE", "LANGWATCH_CLI_CONFIG"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolving which profile is in use", () => {
  describe("when nothing is set", () => {
    it("resolves the default", () => {
      expect(resolveProfileName()).toBe(DEFAULT_PROFILE);
    });
  });

  describe("when only the environment is set", () => {
    it("resolves the environment's profile", () => {
      process.env.LANGWATCH_PROFILE = "home";
      expect(resolveProfileName()).toBe("home");
    });
  });

  describe("when the flag and the environment disagree", () => {
    /** @scenario "the flag beats the environment beats the default" */
    it("the flag wins", () => {
      process.env.LANGWATCH_PROFILE = "home";
      expect(resolveProfileName("work")).toBe("work");
    });
  });

  describe("when the value is blank or whitespace", () => {
    it("falls back to the default rather than an empty filename", () => {
      process.env.LANGWATCH_PROFILE = "   ";
      expect(resolveProfileName()).toBe(DEFAULT_PROFILE);
    });
  });
});

describe("where a profile's credentials live", () => {
  describe("given the default profile", () => {
    /** @scenario "with nothing set, the default profile is the file that always existed" */
    it("stays at the file every existing install already has", () => {
      // Not profiles/default.json: a migration whose failure mode is "your
      // credentials disappeared" is not worth the tidiness.
      expect(profileConfigPath(DEFAULT_PROFILE)).toBe(
        path.join(os.homedir(), ".langwatch", "config.json"),
      );
    });
  });

  describe("given a named profile", () => {
    /** @scenario "a named profile lives beside the default, not inside it" */
    it("sits beside the default, not inside it", () => {
      expect(profileConfigPath("work")).toBe(
        path.join(os.homedir(), ".langwatch", "profiles", "work.json"),
      );
    });
  });
});

describe("guarding the profile name", () => {
  describe("given a name that could escape the profiles directory", () => {
    /** @scenario "a profile name that could escape the profiles directory is refused" */
    it.each([
      { label: "a parent traversal", name: "../escape" },
      { label: "a nested path", name: "a/b" },
      { label: "a backslash path", name: "a\\b" },
      { label: "a bare dot", name: "." },
      { label: "a double dot", name: ".." },
      { label: "a leading dot", name: ".hidden" },
      { label: "an empty string", name: "" },
      { label: "an absolute path", name: "/etc/passwd" },
    ])("refuses $label", ({ name }) => {
      // Refused, not sanitised: quietly rewriting the name would write
      // credentials somewhere the user never asked for.
      expect(() => assertValidProfileName(name)).toThrow(
        InvalidProfileNameError,
      );
    });
  });

  describe("given an ordinary name", () => {
    it.each([
      "work",
      "home2",
      "acme-prod",
      "a.b_c",
      "A1",
    ])("accepts %s", (name) => {
      expect(() => assertValidProfileName(name)).not.toThrow();
    });
  });

  describe("given a name longer than the cap", () => {
    it("refuses it", () => {
      expect(() => assertValidProfileName("a".repeat(65))).toThrow(
        InvalidProfileNameError,
      );
    });
  });

  describe("when resolving rather than asserting", () => {
    it("still refuses a traversal", () => {
      process.env.LANGWATCH_PROFILE = "../escape";
      expect(() => resolveProfileName()).toThrow(InvalidProfileNameError);
    });
  });
});

describe("solo profiles", () => {
  describe("given the same directory twice", () => {
    /** @scenario "solo is per directory, so re-running reuses the same account" */
    it("resolves the same profile, so a re-run reuses the account", () => {
      // A fresh account per invocation would burn the provisioning rate
      // limit and litter the org with abandoned workspaces.
      expect(soloProfileName("/home/me/app")).toBe(
        soloProfileName("/home/me/app"),
      );
    });
  });

  describe("given two different directories", () => {
    /** @scenario "two directories are two accounts" */
    it("resolves two different profiles — two agents, two identities", () => {
      expect(soloProfileName("/home/me/app")).not.toBe(
        soloProfileName("/home/me/other"),
      );
    });

    it("keeps them apart even when the directories share a basename", () => {
      expect(soloProfileName("/a/app")).not.toBe(soloProfileName("/b/app"));
    });
  });

  describe("whatever the directory is called", () => {
    it.each([
      "/home/me/My Project!",
      "/home/me/../weird",
      "/",
      "/home/me/ünïcode",
    ])("produces a name that is a valid profile: %s", (cwd) => {
      const name = soloProfileName(cwd);
      expect(() => assertValidProfileName(name)).not.toThrow();
      expect(isSoloProfile(name)).toBe(true);
    });
  });

  describe("as a storage mechanism", () => {
    /** @scenario "solo is a profile, not a second mechanism" */
    it("is an ordinary profile, not a parallel code path", () => {
      const name = soloProfileName("/home/me/app");
      expect(profileConfigPath(name)).toBe(
        path.join(os.homedir(), ".langwatch", "profiles", `${name}.json`),
      );
    });
  });
});

describe("the config path every command reads through", () => {
  describe("with no profile set", () => {
    it("is the default profile's file", () => {
      expect(configPath()).toBe(profileConfigPath(DEFAULT_PROFILE));
    });
  });

  describe("with a profile set", () => {
    it("is that profile's file", () => {
      process.env.LANGWATCH_PROFILE = "work";
      expect(configPath()).toBe(profileConfigPath("work"));
    });
  });

  describe("with an explicit config file set as well", () => {
    /** @scenario "an explicit config path still wins over everything" */
    it("uses the explicit file — tests and odd homes rely on it", () => {
      process.env.LANGWATCH_CLI_CONFIG = "/tmp/explicit.json";
      process.env.LANGWATCH_PROFILE = "work";
      expect(configPath()).toBe("/tmp/explicit.json");
    });
  });
});
