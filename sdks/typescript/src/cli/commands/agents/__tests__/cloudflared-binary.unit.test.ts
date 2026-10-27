import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARED_PINS,
  CLOUDFLARED_RELEASE,
  ensureCloudflaredBinary,
  type PinnedAsset,
} from "../dev/cloudflared-binary";

const sha256 = (bytes: Buffer) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

const PINNED_BINARY = Buffer.from("#!/bin/sh\necho pinned cloudflared\n");
const OLD_BINARY = Buffer.from("#!/bin/sh\necho an earlier release\n");

/** A release tarball shaped like Cloudflare's: one `cloudflared` member. */
function makeReleaseArchive(
  dir: string,
  binary: Buffer,
  extraMember?: string,
): Buffer {
  const staging = fs.mkdtempSync(path.join(dir, "staging-"));
  fs.writeFileSync(path.join(staging, "cloudflared"), binary);
  const members = ["cloudflared"];
  if (extraMember) {
    fs.writeFileSync(path.join(staging, extraMember), "planted");
    members.push(extraMember);
  }
  const archivePath = path.join(staging, "release.tgz");
  execFileSync("tar", ["-czf", archivePath, "-C", staging, ...members]);
  return fs.readFileSync(archivePath);
}

describe("ensureCloudflaredBinary", () => {
  let dir: string;
  let binPath: string;
  let archive: Buffer;
  let pins: Record<string, PinnedAsset>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-cloudflared-"));
    binPath = path.join(dir, "bin", "cloudflared");
    archive = makeReleaseArchive(dir, PINNED_BINARY);
    pins = {
      "linux-x64": {
        asset: "cloudflared-linux-amd64",
        sha256: sha256(PINNED_BINARY),
      },
      "darwin-arm64": {
        asset: "cloudflared-darwin-arm64.tgz",
        sha256: sha256(PINNED_BINARY),
        archiveSha256: sha256(archive),
      },
    };
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeBin = (bytes: Buffer) => {
    fs.mkdirSync(path.dirname(binPath), { recursive: true });
    fs.writeFileSync(binPath, bytes);
  };

  describe("when the pinned binary is already on disk", () => {
    /** @scenario "The tunnel binary is checked against the pinned release on every run" */
    it("verifies it and downloads nothing", async () => {
      writeBin(PINNED_BINARY);
      const fetchAsset = vi.fn();

      await ensureCloudflaredBinary({
        binPath,
        platformKey: "linux-x64",
        pins,
        fetchAsset,
      });

      expect(fetchAsset).not.toHaveBeenCalled();
      expect(fs.readFileSync(binPath)).toEqual(PINNED_BINARY);
    });
  });

  describe("when a binary from another release is on disk", () => {
    /** @scenario "A binary from another release is replaced with the pinned one" */
    it("replaces it with the pinned release", async () => {
      writeBin(OLD_BINARY);
      const fetchAsset = vi.fn(async () => PINNED_BINARY);

      await ensureCloudflaredBinary({
        binPath,
        platformKey: "linux-x64",
        pins,
        fetchAsset,
      });

      expect(fetchAsset).toHaveBeenCalledWith(
        `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_RELEASE}/cloudflared-linux-amd64`,
      );
      expect(fs.readFileSync(binPath)).toEqual(PINNED_BINARY);
      expect(fs.statSync(binPath).mode & 0o111).not.toBe(0);
    });
  });

  describe("when the platform ships a release archive", () => {
    /** @scenario "On macOS the release archive is verified before it is unpacked" */
    it("verifies the archive, unpacks the binary and verifies that too", async () => {
      await ensureCloudflaredBinary({
        binPath,
        platformKey: "darwin-arm64",
        pins,
        fetchAsset: async () => archive,
      });

      expect(fs.readFileSync(binPath)).toEqual(PINNED_BINARY);
      // The scratch directory the archive was unpacked into is gone.
      expect(fs.readdirSync(path.dirname(binPath))).toEqual(["cloudflared"]);
    });

    it("refuses an archive that does not match before unpacking it", async () => {
      // Carries the pinned binary, so only the archive digest can catch it.
      const tampered = makeReleaseArchive(dir, PINNED_BINARY, "planted");

      await expect(
        ensureCloudflaredBinary({
          binPath,
          platformKey: "darwin-arm64",
            pins,
          fetchAsset: async () => tampered,
        }),
      ).rejects.toThrow(/does not match the pinned/);
      expect(fs.existsSync(binPath)).toBe(false);
    });

    it("refuses a matching archive whose binary does not match", async () => {
      const wrongBinaryPins = {
        "darwin-arm64": {
          ...pins["darwin-arm64"]!,
          sha256: sha256(OLD_BINARY),
        },
      };

      await expect(
        ensureCloudflaredBinary({
          binPath,
          platformKey: "darwin-arm64",
            pins: wrongBinaryPins,
          fetchAsset: async () => archive,
        }),
      ).rejects.toThrow(/does not match the pinned/);
      expect(fs.existsSync(binPath)).toBe(false);
    });
  });

  describe("when the downloaded binary does not match", () => {
    /** @scenario "A download that does not match the pinned release is refused" */
    it("refuses it, points at --tunnel-url and writes nothing", async () => {
      await expect(
        ensureCloudflaredBinary({
          binPath,
          platformKey: "linux-x64",
            pins,
          fetchAsset: async () => OLD_BINARY,
        }),
      ).rejects.toThrow(/--tunnel-url/);
      expect(fs.existsSync(binPath)).toBe(false);
    });
  });

  describe("when the platform has no pinned release", () => {
    /** @scenario "A platform with no pinned release refuses to run" */
    it("refuses without downloading", async () => {
      const fetchAsset = vi.fn();

      await expect(
        ensureCloudflaredBinary({
          binPath,
          platformKey: "freebsd-x64",
            pins,
          fetchAsset,
        }),
      ).rejects.toThrow(/No pinned cloudflared release for freebsd-x64/);
      expect(fetchAsset).not.toHaveBeenCalled();
    });
  });

  describe("the shipped pins", () => {
    it("pin an archive digest for every platform that ships an archive", () => {
      for (const pin of Object.values(CLOUDFLARED_PINS)) {
        expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
        if (pin.asset.endsWith(".tgz")) {
          expect(pin.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
        } else {
          expect(pin.archiveSha256).toBeUndefined();
        }
      }
    });
  });
});
