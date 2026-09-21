/**
 * Verifies that an already-running AI Gateway process, the one `pnpm dev`
 * (scripts/start.sh) is about to reuse because its derived gateway port is
 * already listening, is actually pointed at THIS worktree's control plane
 * rather than another worktree's or a stale process left over from an
 * earlier run.
 *
 * A gateway proxies LLM traffic and answers every request 200 regardless of
 * which control plane it ships spend, budget and auth traffic to, so a
 * wrong target produces no error anywhere. This script asks the gateway
 * directly, via its GET /debug/control-plane endpoint
 * (services/aigateway/adapters/httpapi/debug_control_plane.go), and prints
 * a loud warning when the answer does not match what this worktree expects,
 * or when the gateway cannot be asked at all (an older build that predates
 * the endpoint is the common case for a mismatch this check cannot name
 * precisely).
 *
 * Usage: tsx check-gateway-control-plane.ts <gatewayPort> <expectedControlPlaneUrl>
 */

export type GatewayReuseVerdict = "ok" | "mismatch" | "unverifiable";

export type ControlPlaneProbe =
  | { kind: "ok"; controlPlaneBaseUrl: string }
  | { kind: "unreachable"; reason: string };

export interface EvaluateGatewayReuseInput {
  /** This worktree's own expected control-plane URL, already derived from PORT by start.sh. */
  expectedControlPlaneUrl: string;
  /** The port the already-running gateway process is listening on. */
  gatewayPort: number;
  probe: ControlPlaneProbe;
}

export interface EvaluateGatewayReuseResult {
  verdict: GatewayReuseVerdict;
  /** Multi-line, unmissable banner. Null only when the verdict is "ok". */
  warning: string | null;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function warningBanner(lines: string[]): string {
  const rule = "!".repeat(78);
  return ["", rule, ...lines.map((line) => `! ${line}`), rule, ""].join("\n");
}

export function evaluateGatewayReuse({
  expectedControlPlaneUrl,
  gatewayPort,
  probe,
}: EvaluateGatewayReuseInput): EvaluateGatewayReuseResult {
  if (probe.kind === "unreachable") {
    return {
      verdict: "unverifiable",
      warning: warningBanner([
        `AI Gateway on :${gatewayPort} is being reused, but it did not answer`,
        "GET /debug/control-plane, so its control-plane target cannot be verified.",
        `Reason: ${probe.reason}`,
        "This usually means the running process predates this check (an older",
        "build from another worktree). It may be silently shipping spend, budget",
        "and auth traffic somewhere other than this worktree's control plane.",
        `Expected control plane: ${expectedControlPlaneUrl}`,
        `Fix: stop whatever is holding :${gatewayPort} and let pnpm dev start its`,
        "own gateway, or rebuild the other worktree's gateway and retry.",
      ]),
    };
  }

  if (
    normalizeUrl(probe.controlPlaneBaseUrl) ===
    normalizeUrl(expectedControlPlaneUrl)
  ) {
    return { verdict: "ok", warning: null };
  }

  return {
    verdict: "mismatch",
    warning: warningBanner([
      `AI Gateway on :${gatewayPort} is being reused, but it is shipping spend,`,
      "budget and auth traffic to a DIFFERENT control plane than this worktree:",
      `  this worktree expects   : ${expectedControlPlaneUrl}`,
      `  the running gateway targets: ${probe.controlPlaneBaseUrl}`,
      "Every request still returns 200 while budgets, spend and auth silently",
      "apply to the wrong project.",
      `Fix: stop whatever is holding :${gatewayPort} and let pnpm dev start its`,
      "own gateway, or set LW_GATEWAY_BASE_URL explicitly before starting it.",
    ]),
  };
}

async function probeControlPlane(
  gatewayPort: number,
): Promise<ControlPlaneProbe> {
  try {
    const response = await fetch(
      `http://localhost:${gatewayPort}/debug/control-plane`,
      {
        signal: AbortSignal.timeout(1500),
      },
    );
    if (!response.ok) {
      return { kind: "unreachable", reason: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as { control_plane_base_url?: string };
    if (!body.control_plane_base_url) {
      return {
        kind: "unreachable",
        reason: "response had no control_plane_base_url",
      };
    }
    return { kind: "ok", controlPlaneBaseUrl: body.control_plane_base_url };
  } catch (error) {
    return {
      kind: "unreachable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const gatewayPort = Number(process.argv[2]);
  const expectedControlPlaneUrl = process.argv[3];
  if (!gatewayPort || !expectedControlPlaneUrl) {
    console.error(
      "usage: check-gateway-control-plane.ts <gatewayPort> <expectedControlPlaneUrl>",
    );
    // Never block pnpm dev startup over a usage error in this guard.
    return;
  }

  const probe = await probeControlPlane(gatewayPort);
  const { warning } = evaluateGatewayReuse({
    expectedControlPlaneUrl,
    gatewayPort,
    probe,
  });
  if (warning) {
    console.error(warning);
  }
}

const isMainModule =
  process.argv[1] != null && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  void main();
}
