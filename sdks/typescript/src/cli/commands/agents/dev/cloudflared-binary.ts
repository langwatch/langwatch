/**
 * The `cloudflared` binary a dev tunnel runs: one reviewed release, pinned by
 * the SHA-256 digests Cloudflare publishes, downloaded by this CLI and matched
 * against those digests before every run.
 *
 * The download is ours rather than the `cloudflared` package's `install()`,
 * because that one unpacks the macOS archive before anything checks it and
 * leaves a binary on disk that nothing ever replaces.
 */

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";

/** The reviewed cloudflared release this CLI downloads and runs. */
export const CLOUDFLARED_RELEASE = "2026.10.4";

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
 * Binary digests are the release notes' "SHA256 Checksums" (for the macOS
 * `.tgz` entries those are the binary inside the archive); archive digests are
 * GitHub's own asset digests.
 */
export const CLOUDFLARED_PINS: Record<string, PinnedAsset> = {
  "linux-x64": {
    asset: "cloudflared-linux-amd64",
    sha256: "ae5e8add7884b0531d66bbca4570d1de491ff6da51e4ebe7eb160cdf241d9e42",
  },
  "linux-arm64": {
    asset: "cloudflared-linux-arm64",
    sha256: "2b7203b4fb0ba28a0c1e12f8855ce2c25f76d266a8d5edafac5540b6812acff6",
  },
  "linux-ia32": {
    asset: "cloudflared-linux-386",
    sha256: "a759230628a894c9262cfc0535926ba1e0cc54260e0b35a6e6cf3833919c67f2",
  },
  "linux-arm": {
    asset: "cloudflared-linux-arm",
    sha256: "f29b44e97ec18dd2971dfdd9bad0c6d460aaa78223b91b186219f02135c08d8c",
  },
  "win32-x64": {
    asset: "cloudflared-windows-amd64.exe",
    sha256: "411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8",
  },
  "win32-ia32": {
    asset: "cloudflared-windows-386.exe",
    sha256: "6d38146a071184959adde89c299e87132d89777ee5318dcb066e6fac861ec63c",
  },
  "darwin-x64": {
    asset: "cloudflared-darwin-amd64.tgz",
    sha256: "fdec0f9a1c726f4c10283fc0cd70e602d510c72887b737270433c81a08c883a9",
    archiveSha256:
      "f11fbef4207d715892331917dafd437f032cf4b7137ed64dea3008338c1c613d",
  },
  "darwin-arm64": {
    asset: "cloudflared-darwin-arm64.tgz",
    sha256: "49e7963072b2ca83fb44c09f4d4a7cda52d390c0c9c6f55bac83454a5bc43910",
    archiveSha256:
      "68b6bc4080ac1330234db2a9002d07f98b000537a1bd531a687b660d4160fa7f",
  },
};

const BRING_YOUR_OWN = "You can also bring your own tunnel with --tunnel-url.";

/** Fetches one release asset's bytes. */
export type FetchAsset = (url: string) => Promise<Buffer>;

const fetchAssetOverHttps: FetchAsset = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Downloading cloudflared ${CLOUDFLARED_RELEASE} failed with HTTP ${response.status}. Check your network connection and try again. ${BRING_YOUR_OWN}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
};

function sha256Of(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fileMatches(filePath: string, expected: string): boolean {
  return fs.existsSync(filePath) && sha256Of(fs.readFileSync(filePath)) === expected;
}

/**
 * Makes sure `binPath` holds the pinned release's binary for this platform,
 * downloading it when it is missing or from another release, and returns
 * once the file on disk has matched the pinned digest. Throws, without
 * running or leaving behind anything unverified, when the platform has no
 * pin, the download does not match, or `userChosen` (CLOUDFLARED_BIN) names
 * a binary of some other release: a file the developer picked is never
 * deleted.
 */
export async function ensureCloudflaredBinary({
  binPath,
  platformKey = `${process.platform}-${process.arch}`,
  userChosen = Boolean(process.env.CLOUDFLARED_BIN),
  pins = CLOUDFLARED_PINS,
  fetchAsset = fetchAssetOverHttps,
}: {
  binPath: string;
  platformKey?: string;
  userChosen?: boolean;
  pins?: Record<string, PinnedAsset>;
  fetchAsset?: FetchAsset;
}): Promise<void> {
  const pin = pins[platformKey];
  if (!pin) {
    throw new Error(
      `No pinned cloudflared release for ${platformKey}. Refusing to run an unverified binary. Bring your own tunnel with --tunnel-url.`,
    );
  }

  if (fileMatches(binPath, pin.sha256)) return;

  if (fs.existsSync(binPath)) {
    if (userChosen) {
      throw new Error(
        `CLOUDFLARED_BIN points at ${binPath}, which is not the cloudflared ${CLOUDFLARED_RELEASE} release this CLI verifies. Unset CLOUDFLARED_BIN to use the verified release. ${BRING_YOUR_OWN}`,
      );
    }
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
    // Checked in memory, so an unverified binary is never written.
    if (sha256Of(downloaded) !== pin.sha256) {
      throw mismatch();
    }
    fs.writeFileSync(binPath, downloaded);
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
function unpackBinary({
  archive,
  binPath,
}: {
  archive: Buffer;
  binPath: string;
}): void {
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
