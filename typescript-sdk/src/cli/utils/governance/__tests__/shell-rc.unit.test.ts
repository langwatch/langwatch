import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GovernanceConfig } from "../config";
import {
  buildExportBlock,
  buildOtelExportBlock,
  detectShell,
  isShellAlreadyConfigured,
  persistBlockToRc,
  rcPath,
} from "../shell-rc";

const cfg: GovernanceConfig = {
  gateway_url: "http://gw.example.com",
  control_plane_url: "http://app.example.com",
  default_personal_vk: { id: "vk_x", secret: "vk-lw-test", prefix: "vk-lw-" },
  default_personal_ingest_keys: {
    claude_code: { id: "ik_c", secret: "sk-lw-claude", prefix: "sk-lw-" },
    codex: { id: "ik_co", secret: "sk-lw-codex", prefix: "sk-lw-" },
  },
};

describe("detectShell", () => {
  const origShell = process.env.SHELL;
  afterEach(() => {
    process.env.SHELL = origShell;
  });

  it("returns 'zsh' for /bin/zsh", () => {
    process.env.SHELL = "/bin/zsh";
    expect(detectShell()).toBe("zsh");
  });

  it("returns 'bash' for /usr/bin/bash", () => {
    process.env.SHELL = "/usr/bin/bash";
    expect(detectShell()).toBe("bash");
  });

  it("returns 'fish' for /usr/local/bin/fish", () => {
    process.env.SHELL = "/usr/local/bin/fish";
    expect(detectShell()).toBe("fish");
  });
});

describe("rcPath", () => {
  it("zsh → ~/.zshrc", () => {
    expect(rcPath("zsh")).toBe(path.join(os.homedir(), ".zshrc"));
  });
  it("bash → ~/.bashrc", () => {
    expect(rcPath("bash")).toBe(path.join(os.homedir(), ".bashrc"));
  });
  it("fish → ~/.config/fish/config.fish", () => {
    expect(rcPath("fish")).toBe(
      path.join(os.homedir(), ".config", "fish", "config.fish"),
    );
  });
});

describe("buildExportBlock", () => {
  it("zsh emits the union'd gateway env pairs across all 5 wrapped tools with key dedup", () => {
    const block = buildExportBlock(cfg, "zsh");
    expect(block).toMatch(/^export ANTHROPIC_BASE_URL=http:\/\/gw/m);
    expect(block).toMatch(/^export ANTHROPIC_AUTH_TOKEN=vk-lw-test/m);
    expect(block).toMatch(/^export OPENAI_BASE_URL=/m);
    expect(block).toMatch(/^export OPENAI_API_KEY=/m);
    expect(block).toMatch(/^export GOOGLE_GEMINI_BASE_URL=/m);
    expect(block).toMatch(/^export GEMINI_API_KEY=/m);
    // duplicates collapsed: only one ANTHROPIC_BASE_URL despite many
    // tools sharing it (claude / cursor / opencode all need it). The
    // dedup is by KEY, first-write-wins; claude (no /v1 suffix) wins
    // over opencode (/v1 suffix). That's intentional: shell-rc is for
    // direct CLI invocation. claude-code + cursor prepend /v1 themselves
    // so the /v1-less base is what they need. opencode does NOT prepend
    // /v1 (Vercel AI SDK), so direct `opencode` (without `langwatch`
    // wrapper) would 404 against shell-rc'd vars - opencode users must
    // route through the wrapper, which sets the /v1-suffixed values
    // per-tool. Documented gap; same as gemini-via-shell-rc requiring
    // `langwatch gemini` for telemetry capture.
    const matches = block.match(/^export ANTHROPIC_BASE_URL=/gm) ?? [];
    expect(matches.length).toBe(1);
    // No OTEL_*_EXPORTER injection - the wrapper is gateway-only.
    // The gateway captures full I/O server-side, so injecting OTEL
    // would double-trace. Path A install (OTLP) is a separate flow.
    expect(block).not.toMatch(/OTEL_TRACES_EXPORTER/);
    expect(block).not.toMatch(/CLAUDE_CODE_ENABLE_TELEMETRY/);
  });

  it("fish emits set -gx lines", () => {
    const block = buildExportBlock(cfg, "fish");
    expect(block).toMatch(/^set -gx ANTHROPIC_BASE_URL http:\/\/gw/m);
  });

  it("empty when no personal VK is provisioned", () => {
    const noVk: GovernanceConfig = {
      ...cfg,
      default_personal_vk: undefined,
    };
    expect(buildExportBlock(noVk, "zsh")).toBe("");
  });
});

describe("buildOtelExportBlock", () => {
  // The exact OTEL_* env block the Path B wrapper computes for a claude
  // run. Shape mirrors buildOtelEnvBlock in wrapper-mode.ts.
  const otelVars: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://app.example.com/api/otel",
    OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer sk-lw-token",
    OTEL_RESOURCE_ATTRIBUTES: "service.name=claude-code",
  };

  describe("given a zsh shell", () => {
    it("emits one export line per env var, order preserved, header value quoted", () => {
      const block = buildOtelExportBlock(otelVars, "zsh");
      const lines = block.split("\n");
      expect(lines[0]).toBe("export CLAUDE_CODE_ENABLE_TELEMETRY=1");
      expect(lines).toContain("export OTEL_TRACES_EXPORTER=otlp");
      expect(lines).toContain(
        "export OTEL_EXPORTER_OTLP_ENDPOINT=http://app.example.com/api/otel",
      );
      // The header value has a space, so it must be single-quoted.
      expect(block).toContain(
        "export OTEL_EXPORTER_OTLP_HEADERS='Authorization=Bearer sk-lw-token'",
      );
      // service.name attr has no whitespace -> no quoting needed.
      expect(block).toContain(
        "export OTEL_RESOURCE_ATTRIBUTES=service.name=claude-code",
      );
    });
  });

  describe("given a fish shell", () => {
    it("emits set -gx lines instead of export", () => {
      const block = buildOtelExportBlock(otelVars, "fish");
      expect(block).toMatch(/^set -gx CLAUDE_CODE_ENABLE_TELEMETRY 1/m);
      expect(block).toContain(
        "set -gx OTEL_EXPORTER_OTLP_HEADERS 'Authorization=Bearer sk-lw-token'",
      );
    });
  });

  describe("given an empty env map", () => {
    it("returns an empty string", () => {
      expect(buildOtelExportBlock({}, "zsh")).toBe("");
    });
  });
});

describe("isShellAlreadyConfigured", () => {
  const origBase = process.env.ANTHROPIC_BASE_URL;
  const origTok = process.env.ANTHROPIC_AUTH_TOKEN;

  afterEach(() => {
    process.env.ANTHROPIC_BASE_URL = origBase;
    process.env.ANTHROPIC_AUTH_TOKEN = origTok;
  });

  it("true when both gateway env vars are present", () => {
    process.env.ANTHROPIC_BASE_URL = "http://gw";
    process.env.ANTHROPIC_AUTH_TOKEN = "vk-lw-x";
    expect(isShellAlreadyConfigured()).toBe(true);
  });

  it("false when only one is present", () => {
    process.env.ANTHROPIC_BASE_URL = "http://gw";
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    expect(isShellAlreadyConfigured()).toBe(false);
  });

  it("false when neither is present", () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    expect(isShellAlreadyConfigured()).toBe(false);
  });
});

describe("persistBlockToRc", () => {
  let tmpHome: string;
  const origHome = process.env.HOME;
  const origUserprofile = process.env.USERPROFILE;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-shellrc-"));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUserprofile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("creates a fresh rc file when none exists and writes the block with markers", () => {
    const written = persistBlockToRc("zsh", "export FOO=bar");
    const content = fs.readFileSync(written, "utf8");
    expect(content).toMatch(/# >>> langwatch begin >>>/);
    expect(content).toMatch(/export FOO=bar/);
    expect(content).toMatch(/# <<< langwatch end <<</);
  });

  it("appends without disturbing existing rc content", () => {
    const target = rcPath("zsh");
    fs.writeFileSync(target, 'alias g="git"\nplugins=(z)');
    persistBlockToRc("zsh", "export FOO=bar");
    const content = fs.readFileSync(target, "utf8");
    expect(content).toMatch(/^alias g="git"\nplugins=\(z\)/);
    expect(content).toMatch(/# >>> langwatch begin >>>/);
    expect(content).toMatch(/export FOO=bar/);
  });

  it("is idempotent - a second run replaces the block in place, not duplicates it", () => {
    persistBlockToRc("zsh", "export FOO=bar");
    persistBlockToRc("zsh", "export FOO=baz");
    const content = fs.readFileSync(rcPath("zsh"), "utf8");
    const beginCount = (content.match(/# >>> langwatch begin >>>/g) ?? [])
      .length;
    expect(beginCount).toBe(1);
    expect(content).toMatch(/export FOO=baz/);
    expect(content).not.toMatch(/export FOO=bar/);
  });

  it("re-writing the OTEL telemetry block replaces it in place, never duplicating", () => {
    const first = buildOtelExportBlock(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://app.example.com/api/otel",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer sk-lw-old",
      },
      "zsh",
    );
    const second = buildOtelExportBlock(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://app.example.com/api/otel",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer sk-lw-new",
      },
      "zsh",
    );
    persistBlockToRc("zsh", first);
    persistBlockToRc("zsh", second);
    const content = fs.readFileSync(rcPath("zsh"), "utf8");
    const beginCount = (content.match(/# >>> langwatch begin >>>/g) ?? [])
      .length;
    expect(beginCount).toBe(1);
    expect(content).toContain("Authorization=Bearer sk-lw-new");
    expect(content).not.toContain("sk-lw-old");
  });
});
