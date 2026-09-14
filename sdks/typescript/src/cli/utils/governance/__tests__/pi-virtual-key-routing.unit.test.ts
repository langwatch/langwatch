/**
 * A cached personal virtual key changes nothing about how pi is captured.
 *
 * pi hardcodes each catalog model's base URL and ignores OPENAI_BASE_URL /
 * ANTHROPIC_BASE_URL, so the gateway swap a key normally triggers cannot work
 * for it: the key would be sent to the vendor, rejected, and echoed back in the
 * 401 body, while the session-file path was skipped as the mutually-exclusive
 * other mode. Zero capture, no error, a reassuring notice. ADR-132 §7.
 *
 * The pair of scenarios this file binds is the two arms of that variable, and
 * the discrimination lives in the arms, not in the notice:
 *
 *   - key cached    -> the gateway swap does NOT happen. A control tool on a
 *                      byte-identical config DOES go to the gateway, so the
 *                      assertion cannot be passing because nothing routes.
 *   - no key cached -> no key is created for the run either. A pi run resolved
 *                      to the gateway with no key on disk would lazily mint a
 *                      personal one (`resolveWrapperMode`'s gateway branch), so
 *                      "no key was issued" is the observable that a wrongly
 *                      routed no-key run cannot produce. The control is the
 *                      same call for a tool whose gateway path is real, which
 *                      does issue one.
 *
 * Both assertions are made at the seam the launcher actually uses:
 * `resolveWrapperPath` first, then its result handed to `resolveWrapperMode`
 * as a FORCED mode, exactly as `runWrapped` does (wrapper.ts:446-481). Calling
 * `resolveWrapperMode` with no forced mode exercises a branch the shipped
 * launcher never reaches.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cliApi from "../cli-api";
import * as configMod from "../config";
import type { GovernanceConfig } from "../config";
import { resolveWrapperMode } from "../wrapper-mode";
import { resolveWrapperPath } from "../wrapper-path-choice";
import { envForTool } from "../tool-env";

vi.mock("../cli-api", async () => {
  const actual = await vi.importActual<typeof cliApi>("../cli-api");
  return {
    ...actual,
    mintIngestionKey: vi.fn(),
    listIngestionKeys: vi.fn(),
    issuePersonalVirtualKey: vi.fn(),
  };
});

vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof configMod>("../config");
  return { ...actual, saveConfig: vi.fn() };
});

const VK_SECRET = "vk-lw-personal-secret";

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-pi-vk-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  (cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    token: "ik-lw-pi-token",
    prefix: "ik-lw-pi",
    endpoint: "http://app.example.com/api/otel",
  });
  (cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockRejectedValue(
    new Error("not used"),
  );
  (cliApi.issuePersonalVirtualKey as ReturnType<typeof vi.fn>).mockResolvedValue(
    { id: "vk-new", secret: "vk-lw-freshly-issued", prefix: "vk-lw" },
  );
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.clearAllMocks();
});

function baseCfg(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    gateway_url: "http://gw.example.com",
    control_plane_url: "http://app.example.com",
    access_token: "tok",
    user: { id: "u1", email: "u@example.com" },
    organization: { id: "o1", slug: "acme" },
    ...overrides,
  };
}

/**
 * A user who, offered the choice, opts into the gateway.
 *
 * It answers rather than throwing so that a build which wrongly OFFERS pi the
 * choice fails on the routing assertions — the ones this file is about —
 * instead of on the stub. `prompted` is asserted false alongside them, so
 * being asked at all is still a failure, just a legible one.
 */
const optsIntoGateway = vi.fn(async () => ({
  path: "gateway",
})) as unknown as Parameters<typeof resolveWrapperPath>[0]["promptImpl"];

/**
 * One launch, resolved the way `runWrapped` resolves it: path first, then mode
 * with the path's answer forced in. Returns both halves plus everything the
 * launcher would have printed, so a test can assert on the run as a whole
 * rather than on one function's return value.
 */
async function launch(tool: string, cfg: GovernanceConfig) {
  const said: string[] = [];
  const pathChoice = await resolveWrapperPath({
    cfg,
    tool,
    args: [],
    isTTY: true,
    promptImpl: optsIntoGateway,
    writeImpl: (s) => void said.push(s),
    env: {},
  });
  const toolEnv = envForTool(cfg, tool);
  const modeResult = await resolveWrapperMode(
    cfg,
    tool,
    toolEnv.vars,
    toolEnv.clears ?? [],
    pathChoice.mode,
  );
  if (modeResult.notice) said.push(`${modeResult.notice}\n`);
  return { pathChoice, modeResult, said: said.join("") };
}

describe("given a pi session launched through the wrapper", () => {
  describe("when a personal virtual key is cached on this machine", () => {
    /**
     * The key is present and the gateway swap still does not happen.
     *
     * The control is the load-bearing half: `cursor` on a byte-identical
     * config, resolved through the same two calls, DOES land on the gateway —
     * and on the very same two variables (`OPENAI_BASE_URL` /
     * `OPENAI_API_KEY`) pi would have been handed. Without it, "pi did not go
     * to the gateway" would also pass on a build where nothing does.
     */
    /** @scenario "A virtual key does not switch pi to server-side capture" */
    it("keeps pi on file capture and the key out of its env, while a control tool on the same config takes the gateway", async () => {
      const pi = await launch(
        "pi",
        baseCfg({ default_personal_vk: { id: "vk1", secret: VK_SECRET } }),
      );
      const control = await launch(
        "cursor",
        baseCfg({ default_personal_vk: { id: "vk1", secret: VK_SECRET } }),
      );

      // Both seams agree: the launcher chose file capture and the resolver
      // kept it there — and the choice was never offered, so no answer could
      // have produced anything else.
      expect(pi.pathChoice.prompted).toBe(false);
      expect(pi.pathChoice.mode).toBe("ingestion");
      expect(pi.modeResult.mode).toBe("ingestion");
      // Nothing about the gateway reaches pi's child: not the base URL it
      // would ignore, and — the reason this matters — not the key it would
      // send to the vendor instead.
      expect(pi.modeResult.vars.OPENAI_BASE_URL).toBeUndefined();
      expect(JSON.stringify(pi.modeResult.vars)).not.toContain(VK_SECRET);

      // The control took the other path on the same inputs, on the exact two
      // variables asserted absent above.
      expect(control.pathChoice.mode).toBe("gateway");
      expect(control.modeResult.mode).toBe("gateway");
      expect(control.modeResult.vars.OPENAI_BASE_URL).toBeDefined();
      expect(control.modeResult.vars.OPENAI_API_KEY).toBe(VK_SECRET);
    });

    /**
     * The path taken is said out loud, in the words the shipped launcher uses.
     *
     * Asserted on what the LAUNCHER printed, not on `resolveWrapperMode`'s
     * `notice`: on this path that field is empty, because the mode was already
     * "ingestion" when its downgrade branch was evaluated. A test that only
     * read the returned notice would pass while the real run said nothing.
     */
    /** @scenario "A virtual key does not switch pi to server-side capture" */
    it("tells the user the session is read from its file rather than routed through the gateway", async () => {
      const pi = await launch(
        "pi",
        baseCfg({ default_personal_vk: { id: "vk1", secret: VK_SECRET } }),
      );

      expect(pi.said).toContain(
        "pi is captured from its session file rather than through the gateway",
      );
      // Forced by us, not chosen by an admin: blaming the org sends them
      // hunting for a switch nobody flipped.
      expect(pi.said).not.toContain("org admin");
    });
  });

  describe("when no virtual key is cached on this machine", () => {
    /**
     * No key is created for the run.
     *
     * This is the arm's real assertion. A build that resolved pi to the
     * gateway with nothing on disk would not fail with a missing key — it
     * would ASK the control plane for one and print that it had, then run pi
     * with a fresh virtual key it sends to the vendor. So "no key was issued"
     * is the observable a wrongly-routed no-key run cannot produce, and the
     * control below is the same call for a tool whose gateway path is real.
     */
    /** @scenario "A session with no virtual key is captured from the file" */
    it("creates no virtual key for the run, while a control tool on the same config is issued one", async () => {
      const pi = await launch("pi", baseCfg());

      expect(pi.pathChoice.prompted).toBe(false);
      expect(pi.pathChoice.mode).toBe("ingestion");
      expect(pi.modeResult.mode).toBe("ingestion");
      expect(cliApi.issuePersonalVirtualKey).not.toHaveBeenCalled();

      // The control: same empty config, a tool whose gateway path is real and
      // which therefore does mint a personal key on its first gateway run.
      const control = await launch("cursor", baseCfg());
      expect(control.modeResult.mode).toBe("gateway");
      expect(cliApi.issuePersonalVirtualKey).toHaveBeenCalled();
    });
  });
});
