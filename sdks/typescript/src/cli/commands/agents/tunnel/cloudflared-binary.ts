/**
 * The `cloudflared` binary a dev tunnel runs: one reviewed release, downloaded
 * by this CLI and matched against Cloudflare's published SHA-256 before every
 * run. No npm wrapper: it unpacked the macOS archive unchecked (ADR-098).
 */

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import chalk from "chalk";

/** The reviewed cloudflared release this CLI downloads and runs. */
export const CLOUDFLARED_RELEASE = "2026.10.5";

const RELEASE_DOWNLOAD_BASE = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_RELEASE}/`;

const CLOUDFLARE_TERMS_URL = "https://www.cloudflare.com/website-terms/";

/**
 * One platform's asset of the pinned release. `sha256` is the binary that
 * runs. `archiveSha256` is set for platforms that ship a tarball (macOS) and
 * covers the archive, which is checked before it is unpacked.
 */
export interface PinnedAsset {
  asset: string;
  sha256: string;
  archiveSha256?: string;
}

/**
 * The pinned assets of {@link CLOUDFLARED_RELEASE}, keyed `platform-arch`.
 * `sha256` comes from the release notes, whose `.tgz` entries hash the binary
 * inside; `archiveSha256` is GitHub's own asset digest.
 */
export const CLOUDFLARED_PINS: Record<string, PinnedAsset> = {
  "linux-x64": {
    asset: "cloudflared-linux-amd64",
    sha256: "e1bc0cf084fd9e590554fe769a86b1db46701c3f847a43d902f7b974a4e16298",
  },
  "linux-arm64": {
    asset: "cloudflared-linux-arm64",
    sha256: "72e0d05a67e09da87cf495e409a28c3cc5994dd23fc66a982eebea6a55923b7d",
  },
  "linux-ia32": {
    asset: "cloudflared-linux-386",
    sha256: "f2de713829081837130b38e27f3c95aa9d7fc1a4f48b833362d21234dd8780d8",
  },
  "linux-arm": {
    asset: "cloudflared-linux-arm",
    sha256: "a018911e1bbfd739937f3011f589e9e73245baeee14742f8b3413472bb007adc",
  },
  "win32-x64": {
    asset: "cloudflared-windows-amd64.exe",
    sha256: "db4e4c413612a0916f3e1679d3caaf376f94911952d163028fb726fb2e0516a9",
  },
  "win32-ia32": {
    asset: "cloudflared-windows-386.exe",
    sha256: "66cba8003e4f87a8e6b772f331b8c04c7d41ac4f2dc30dd2c13ae09de3b6007e",
  },
  "darwin-x64": {
    asset: "cloudflared-darwin-amd64.tgz",
    sha256: "cb09afb9b4d0a4730de477ac710aebb6107568930a8345775629bf264f70c284",
    archiveSha256: "6699392fed92367808c248c2d90bed66e49bbf66e1b4ee3e4141230f3f7391b3",
  },
  "darwin-arm64": {
    asset: "cloudflared-darwin-arm64.tgz",
    sha256: "2b23964528ddcd641c1449275df8b5b51e3c7193b5257919846331bc5bc13b0f",
    archiveSha256: "184c7d4f5f977348243a6d7ca8f6cf6073b9b2746cfe8c1fe15aa59e9a522bf0",
  },
};

const BRING_YOUR_OWN = "You can also bring your own tunnel with --tunnel-url.";

/**
 * How long the whole download may take, body included: long enough for the
 * ~40 MB asset on a slow link, short enough that a stalled connection fails
 * instead of leaving the session spinning.
 */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** Fetches one release asset's bytes. */
export type FetchAsset = (url: string) => Promise<Buffer>;

const fetchAssetOverHttps: FetchAsset = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(
        `Downloading cloudflared ${CLOUDFLARED_RELEASE} failed with HTTP ${response.status}. Check your network connection and try again. ${BRING_YOUR_OWN}`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `Downloading cloudflared ${CLOUDFLARED_RELEASE} did not finish within ${DOWNLOAD_TIMEOUT_MS / 60_000} minutes. Check your network connection and try again. ${BRING_YOUR_OWN}`,
      );
    }
    throw error;
  }
};

function sha256Of(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fileMatches(filePath: string, expected: string): boolean {
  return fs.existsSync(filePath) && sha256Of(fs.readFileSync(filePath)) === expected;
}

/**
 * Leaves the pinned release's binary at `binPath` (the CLI's own file: one that
 * does not match is replaced), and throws, leaving nothing unverified, when the
 * platform has no pin or the download does not match.
 */
export async function ensureCloudflaredBinary({
  binPath,
  platformKey = `${process.platform}-${process.arch}`,
  pins = CLOUDFLARED_PINS,
  fetchAsset = fetchAssetOverHttps,
}: {
  binPath: string;
  platformKey?: string;
  pins?: Record<string, PinnedAsset>;
  fetchAsset?: FetchAsset;
}): Promise<void> {
  const pin = pins[platformKey];
  if (!pin) {
    throw new Error(
      `No pinned cloudflared release for ${platformKey}. Refusing to run an unverified binary. Bring your own tunnel with --tunnel-url.`,
    );
  }

  if (fileMatches(binPath, pin.sha256)) {
    // The bytes are right, but a copied or restored cache can lose the mode.
    fs.chmodSync(binPath, 0o755);
    return;
  }

  if (fs.existsSync(binPath)) {
    console.log(
      chalk.gray(
        `Replacing the cloudflared binary on disk, which is not release ${CLOUDFLARED_RELEASE}.`,
      ),
    );
    fs.rmSync(binPath, { force: true });
  }

  console.log(
    chalk.gray(
      `Downloading the cloudflared binary (release ${CLOUDFLARED_RELEASE}). Quick tunnels are a Cloudflare service, subject to the Cloudflare terms: ${CLOUDFLARE_TERMS_URL}`,
    ),
  );
  const downloaded = await fetchAsset(RELEASE_DOWNLOAD_BASE + pin.asset);
  fs.mkdirSync(path.dirname(binPath), { recursive: true });

  if (pin.archiveSha256) {
    if (sha256Of(downloaded) !== pin.archiveSha256) {
      throw mismatch();
    }
    unpackBinary({ archive: downloaded, binPath });
  } else {
    // Checked in memory, so an unverified binary is never written. Staged and
    // renamed so a second session never reads a half-written file.
    if (sha256Of(downloaded) !== pin.sha256) {
      throw mismatch();
    }
    const staged = `${binPath}.${process.pid}.download`;
    fs.writeFileSync(staged, downloaded);
    fs.renameSync(staged, binPath);
  }

  if (!fileMatches(binPath, pin.sha256)) {
    fs.rmSync(binPath, { force: true });
    throw mismatch();
  }
  fs.chmodSync(binPath, 0o755);
}

function mismatch(): Error {
  return new Error(
    `The downloaded cloudflared does not match the pinned ${CLOUDFLARED_RELEASE} checksum. Refusing to run it. ${BRING_YOUR_OWN}`,
  );
}

/**
 * Unpacks the `cloudflared` member of a verified release archive to
 * `binPath`, by way of a scratch directory beside it so the final rename
 * stays on one filesystem.
 */
function unpackBinary({ archive, binPath }: { archive: Buffer; binPath: string }): void {
  const scratch = fs.mkdtempSync(path.join(path.dirname(binPath), ".cloudflared-"));
  try {
    const archivePath = path.join(scratch, "release.tgz");
    fs.writeFileSync(archivePath, archive);
    execFileSync("tar", ["-xzf", archivePath, "-C", scratch, "cloudflared"], {
      stdio: "ignore",
    });
    fs.renameSync(path.join(scratch, "cloudflared"), binPath);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
