/**
 * The output contract's RESOLUTION half, pinned: flag normalisation (legacy
 * `-f/--format`, bare `--json` → new `-o/--output`, `--json <fields>`, `--jq`,
 * `--agent`), agent-mode detection, and `applyOutputContext` pushing the
 * resolved context into the error/colour machinery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import chalk from "chalk";
import {
  AGENT_MODE_ENV_VARS,
  applyOutputContext,
  isAgentModeEnv,
  resolveOutputOptions,
} from "../output";
import { getOutputFormat } from "../errorOutput";

/** Agent-mode env vars from the host (e.g. CLAUDECODE under Claude Code) must not leak into tests. */
let savedAgentEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedAgentEnv = Object.fromEntries(
    AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]),
  );
  for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const name of AGENT_MODE_ENV_VARS) {
    const value = savedAgentEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

describe("resolveOutputOptions flag normalisation", () => {
  describe("given the legacy spellings", () => {
    it("maps -f/--format json onto json", () => {
      expect(resolveOutputOptions({ format: "json" }).format).toBe("json");
    });

    it("maps the bare boolean --json onto json", () => {
      expect(resolveOutputOptions({ json: true }).format).toBe("json");
    });

    it("keeps legacy human spellings (digest, table, jsonl) on the table", () => {
      expect(resolveOutputOptions({ format: "digest" }).format).toBe("table");
      expect(resolveOutputOptions({ format: "table" }).format).toBe("table");
      expect(resolveOutputOptions({ format: "jsonl" }).format).toBe("table");
    });

    it("ignores an -o value that is not a format (trace export's file path)", () => {
      // The contract's -o flag itself rejects unknown values at parse time
      // (choices — see the registerOutputOptions tests below). This leniency
      // is still load-bearing for `trace export`: its own `-o, --output
      // <file>` wins the conflict check in registerOutputOptions, and the
      // preAction hook feeds EVERY command's options through this function.
      expect(resolveOutputOptions({ output: "out.csv", format: "jsonl" }).format).toBe("table");
    });
  });

  describe("given the new contract", () => {
    it("lets -o/--output beat the legacy -f/--format", () => {
      expect(resolveOutputOptions({ output: "json", format: "table" }).format).toBe("json");
    });

    it("implies json from --json <fields> and splits the list", () => {
      const resolved = resolveOutputOptions({ json: "name, id" });

      expect(resolved.format).toBe("json");
      expect(resolved.fields).toEqual(["name", "id"]);
    });

    it("implies json from --jq", () => {
      expect(resolveOutputOptions({ jq: ".items[]" }).format).toBe("json");
    });

    it("accepts every contract format via -o", () => {
      for (const format of ["table", "json", "agents", "yaml"] as const) {
        expect(resolveOutputOptions({ output: format }).format).toBe(format);
      }
    });
  });

  describe("given nothing at all", () => {
    it("defaults to the human table", () => {
      expect(resolveOutputOptions({}).format).toBe("table");
    });
  });
});

describe("agent-mode detection", () => {
  it.each(AGENT_MODE_ENV_VARS.map((name) => [name]))(
    "activates on the %s env var",
    (name) => {
      expect(isAgentModeEnv({ [name]: "1" })).toBe(true);
      expect(resolveOutputOptions({}, { [name]: "1" }).format).toBe("agents");
    },
  );

  it("ignores env values that mean 'off'", () => {
    for (const value of ["", "0", "false"]) {
      expect(isAgentModeEnv({ CLAUDECODE: value })).toBe(false);
    }
  });

  it("activates on the --agent flag without any env var", () => {
    const resolved = resolveOutputOptions({ agent: true }, {});

    expect(resolved.agent).toBe(true);
    expect(resolved.format).toBe("agents");
  });

  it("lets an explicit -o beat the agent default", () => {
    const resolved = resolveOutputOptions({ agent: true, output: "yaml" }, {});

    expect(resolved.format).toBe("yaml");
    expect(resolved.agent).toBe(true);
  });

  it("lets an explicit --json/-f json beat the agent default", () => {
    expect(resolveOutputOptions({ agent: true, json: true }, {}).format).toBe("json");
    expect(resolveOutputOptions({ agent: true, format: "json" }, {}).format).toBe("json");
  });
});

describe("applyOutputContext", () => {
  let savedLevel: typeof chalk.level;

  beforeEach(() => {
    savedLevel = chalk.level;
  });

  afterEach(async () => {
    chalk.level = savedLevel;
    await applyOutputContext(resolveOutputOptions({}, {}));
  });

  it("turns colour off and marks output as machine in agent mode", async () => {
    await applyOutputContext(resolveOutputOptions({ agent: true }, {}));

    expect(chalk.level).toBe(0);
    expect(getOutputFormat()).toBe("agents");
  });

  it("marks every machine format as structured for the error path, keeping agents compact", async () => {
    for (const format of ["json", "yaml"] as const) {
      await applyOutputContext(resolveOutputOptions({ output: format }, {}));
      expect(getOutputFormat()).toBe("json");
    }
    await applyOutputContext(resolveOutputOptions({ output: "agents" }, {}));
    expect(getOutputFormat()).toBe("agents");
  });

  it("keeps the human default untouched", async () => {
    await applyOutputContext(resolveOutputOptions({}, {}));

    expect(chalk.level).toBe(savedLevel);
    expect(getOutputFormat()).toBe("text");
  });
});
