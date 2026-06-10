/**
 * LocalFilesystemDriver — StorageDriver implementation over the local filesystem.
 *
 * **Single-replica only.** This driver stores objects under `file:///root/...`
 * paths on the local filesystem. Multi-pod Kubernetes deployments MUST NOT use
 * this driver because pods do not share a local filesystem. Single-replica
 * self-host installs (small footprints, hobbyist / air-gapped / pre-pilot
 * deployments) and `make quickstart` local-dev environments can use it safely;
 * the Helm chart enforces the constraint by refusing to render
 * `localFilesystem.enabled=true` together with `replicaCount > 1`. Operators
 * who outgrow single-replica should switch to S3Driver / AzureBlobDriver.
 *
 * Atomicity invariant: PUT writes to a `.tmp.<rand>` sibling first, then uses
 * `fs.rename` (POSIX rename(2)) to atomically replace the final path. The final
 * path always reflects a complete write; a process crash mid-write orphans the
 * tmp file (negligible cost) but never leaves torn bytes at the final path.
 */
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Readable } from "node:stream";
import type { StorageDriver } from "./storage-driver";
import { getUriScheme } from "./uri";
import { ObjectNotFoundError } from "./errors";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:stored-objects:local-filesystem-driver");

/**
 * Converts a `file:` URI to an absolute filesystem path.
 *
 * Handles both `file:///abs/path` (authority + abs path) and `file:/abs/path`
 * (no authority) per RFC 8089, and percent-decodes the path. Using a hand
 * rolled `uri.slice("file://".length)` is brittle: `file:/tmp/foo` becomes
 * `tmp/foo` (a relative path) and percent-escaped characters survive.
 *
 * @throws if the URI does not use the `file:` scheme.
 */
function parseFileUri(uri: string): string {
  const scheme = getUriScheme(uri);
  if (scheme !== "file") {
    throw new Error(
      `LocalFilesystemDriver only handles file: URIs, got: "${uri}"`,
    );
  }
  const parsed = new URL(uri);
  return decodeURIComponent(parsed.pathname);
}

/**
 * StorageDriver implementation backed by the local filesystem.
 *
 * See class-level JSDoc for single-replica constraints and atomicity guarantees.
 */
export class LocalFilesystemDriver implements StorageDriver {
  /**
   * Returns a readable stream for the bytes at the given `file://` URI.
   *
   * @throws {ObjectNotFoundError} if no file exists at the URI.
   */
  async get(uri: string): Promise<Readable> {
    const filePath = parseFileUri(uri);
    const stream = createReadStream(filePath);

    return new Promise<Readable>((resolve, reject) => {
      stream.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          reject(new ObjectNotFoundError(uri));
        } else {
          reject(err);
        }
      });
      // Once the stream is open (or readable), it's safe to hand it back.
      stream.once("open", () => resolve(stream));
    });
  }

  /**
   * Atomically writes `bytes` to the given `file://` URI.
   *
   * `mediaType` is unused — the filesystem stores raw bytes without metadata.
   * Atomicity is achieved by writing to a `.tmp.<rand>` sibling and then
   * renaming it into place.
   */
  async put(uri: string, bytes: Buffer, _mediaType: string): Promise<void> {
    const finalPath = parseFileUri(uri);
    const tmpPath = `${finalPath}.tmp.${crypto.randomBytes(6).toString("hex")}`;

    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    try {
      await fs.writeFile(tmpPath, bytes);
      await fs.rename(tmpPath, finalPath);
    } catch (err) {
      // Best-effort cleanup of the orphaned tmp file. ENOENT is fine (the
      // file was already gone). Any other unlink error is logged but does
      // NOT mask the original write/rename error the caller cares about.
      await fs.unlink(tmpPath).catch((unlinkErr: NodeJS.ErrnoException) => {
        if (unlinkErr.code !== "ENOENT") {
          logger.warn(
            { tmpPath, finalPath, unlinkErr },
            "failed to clean up orphaned tmp file after write failure",
          );
        }
      });
      throw err;
    }
  }

  /**
   * Deletes the file at the given `file://` URI.
   *
   * Deleting a non-existent file is a no-op (force: true ignores ENOENT).
   */
  async delete(uri: string): Promise<void> {
    const filePath = parseFileUri(uri);
    await fs.rm(filePath, { force: true });
  }

  /**
   * Returns `true` if a file exists at the given `file://` URI, `false` if not.
   *
   * @throws for errors other than ENOENT (e.g. permission denied).
   */
  async exists(uri: string): Promise<boolean> {
    const filePath = parseFileUri(uri);
    try {
      await fs.access(filePath);
      return true;
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }
}
