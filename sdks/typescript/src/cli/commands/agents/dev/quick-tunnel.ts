/**
 * Cloudflare quick-tunnel provisioning for a dev tunnel session: download a
 * pinned, checksum-verified `cloudflared` binary on first use and start a
 * quick tunnel for the local URL.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import chalk from "chalk";

/** How long to wait for the tunnel to report its public URL. */
const TUNNEL_URL_TIMEOUT_MS = 30_000;

const CLOUDFLARE_TERMS_URL = "https://www.cloudflare.com/website-terms/";

/**
 * The reviewed cloudflared release this CLI downloads. `install()` would
 * otherwise fetch whatever `latest` points at, which no one reviewed.
 */
const CLOUDFLARED_RELEASE = "2026.8.2";

/**
 * SHA-256 of each raw-binary asset of {@link CLOUDFLARED_RELEASE}, from the
 * GitHub release's own asset digests, keyed `platform-arch`. macOS ships a
 * tarball whose digest covers the archive, not the extracted binary, so the
 * darwin platforms are not listed and rely on the pinned tag over TLS.
 */
const CLOUDFLARED_SHA256: Record<string, string> = {
  "linux-x64": "fcfb02b575a52ca1af2e3267af4e1517bcdeb30ac48c834c69abaed3c0576ad2",
  "linux-arm64": "7747d94570fb390cf47dcb4f9555c193c6355cda9793f0d878d9049e5d6a7790",
  "linux-ia32": "39845d980a4b74b9c84530a28d8fea1fe6c476de26460275602162b349f1cbef",
  "linux-arm": "19809425f60a6261241dfa66a42b4115bab07c295396a3c4d5d7c247fc4e1412",
  "win32-x64": "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5",
  "win32-ia32": "6acb072357618fa16c53c43e05438ed728aacd47119f1c6c3aa1a668c3299b43",
};

/** The tunnel process surface the session needs, satisfied by cloudflared's Tunnel. */
export interface TunnelHandle {
  stop: () => void;
  once(event: "url", listener: (url: string) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: unknown) => void): unknown;
}

/**
 * The platforms that knowingly run without a binary digest: macOS ships a
 * tarball whose digest covers the archive, not the extracted binary, so
 * those installs rely on the pinned tag over TLS.
 */
const UNVERIFIED_PLATFORMS = new Set(["darwin-x64", "darwin-arm64"]);

/** Verifies the binary about to run against the pinned release digest. */
function verifyBinary(binPath: string): void {
  const platformKey = `${process.platform}-${process.arch}`;
  const expected = CLOUDFLARED_SHA256[platformKey];
  if (!expected) {
    // Fail closed: a platform that is neither listed in the digest table nor
    // named as a known exception must not run unverified, so a typo in
    // either table cannot silently skip the check.
    if (UNVERIFIED_PLATFORMS.has(platformKey)) return;
    throw new Error(
      `No pinned cloudflared checksum for ${platformKey}. Refusing to run an unverified binary. Bring your own tunnel with --tunnel-url.`,
    );
  }
  const actual = crypto
    .createHash("sha256")
    .update(fs.readFileSync(binPath))
    .digest("hex");
  if (actual !== expected) {
    // Removing it makes the next run download the pinned release, so the
    // advice below resolves the mismatch instead of repeating it.
    fs.rmSync(binPath, { force: true });
    throw new Error(
      `The cloudflared binary does not match the pinned ${CLOUDFLARED_RELEASE} checksum. Refusing to run it. It has been removed, so running the command again downloads the pinned release. You can also bring your own tunnel with --tunnel-url.`,
    );
  }
}

/**
 * Provision the Cloudflare quick tunnel via the `cloudflared` package,
 * downloading the pinned binary release on first use (with the Cloudflare
 * terms notice printed before the download) and verifying its checksum.
 * Resolves with the public URL and a handle to stop the tunnel; rejects when
 * no URL arrives within the timeout.
 *
 * The import is lazy on purpose: only tunnel-provisioning runs pay for it,
 * and `--tunnel-url` sessions never load it (CLI boot-graph rule).
 */
export async function startQuickTunnel({
  localUrl,
}: {
  localUrl: string;
}): Promise<{ url: string; tunnel: TunnelHandle }> {
  const cloudflared = await import("cloudflared");

  if (!fs.existsSync(cloudflared.bin)) {
    console.log(
      chalk.gray(
        `First run: downloading the cloudflared binary (release ${CLOUDFLARED_RELEASE}). Quick tunnels are a Cloudflare service, subject to the Cloudflare terms: ${CLOUDFLARE_TERMS_URL}`,
      ),
    );
    await cloudflared.install(cloudflared.bin, CLOUDFLARED_RELEASE);
  }

  // Every run, not only the run that downloaded: a binary already on disk
  // comes from an earlier release, another tool, or a tampered cache, and
  // executing it unverified would break the checksum guarantee this path
  // advertises.
  verifyBinary(cloudflared.bin);

  const tunnel = cloudflared.Tunnel.quick(localUrl);
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      tunnel.stop();
      reject(
        new Error(
          `The tunnel did not report a public URL within ${TUNNEL_URL_TIMEOUT_MS / 1000} seconds. Check your network connection and try again, or bring your own tunnel with --tunnel-url.`,
        ),
      );
    }, TUNNEL_URL_TIMEOUT_MS);
    tunnel.once("url", (tunnelUrl: string) => {
      clearTimeout(timeout);
      resolve(tunnelUrl);
    });
    tunnel.once("error", (error: Error) => {
      clearTimeout(timeout);
      tunnel.stop();
      reject(error);
    });
    tunnel.once("exit", (code: number | null) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `The tunnel process exited (code ${code ?? "unknown"}) before reporting a URL. Try again, or bring your own tunnel with --tunnel-url.`,
        ),
      );
    });
  });

  return { url, tunnel };
}
