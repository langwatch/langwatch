/**
 * The local filesystem as one placed backend. A write lands in a temporary
 * file and is renamed into place, so a refused or failed body leaves nothing.
 * Its digest is kept beside the tree, under `.digests/`, for confirm to read.
 */
import { randomBytes } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ObjectDigest, StoredObjectAddress } from "./members.ts";
import {
  digestOf,
  measureBody,
  StorageNotWritableError,
  StoredObjectNotFoundError,
  UnsignableDownloadError,
  type ObjectBackend,
} from "./object-storage-backend.ts";

const DIGESTS = ".digests";

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

const WRITE_REFUSALS = ["EACCES", "EPERM", "EROFS"];

function refusedWrite(error: unknown): unknown {
  const refused = WRITE_REFUSALS.some((code) => isCode(error, code));
  return refused ? new StorageNotWritableError() : error;
}

/** A key names a path under the root and never leaves it, nor reaches the digest tree. */
function pathsOf(root: string, key: string): { object: string; digest: string } {
  const segments = key.split("/");
  const unsafe = segments.some((segment) => segment === "" || segment === "." || segment === "..");
  if (unsafe || segments[0] === DIGESTS) {
    throw new Error(`The object key "${key}" does not name a path under the storage root.`);
  }
  return { object: path.join(root, ...segments), digest: path.join(root, DIGESTS, ...segments) };
}

async function writeAtomically(
  target: string,
  body: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp.${randomBytes(6).toString("hex")}`;
  try {
    await pipeline(Readable.from(body, { objectMode: false }), createWriteStream(temporary));
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function heldDigest(paths: {
  object: string;
  digest: string;
}): Promise<ObjectDigest | undefined> {
  try {
    const [held, stat] = await Promise.all([
      fs.readFile(paths.digest, "utf8"),
      fs.stat(paths.object),
    ]);
    const parsed: unknown = JSON.parse(held);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    if (!("sha256" in parsed) || typeof parsed.sha256 !== "string") return undefined;
    if (!("byteLength" in parsed) || parsed.byteLength !== stat.size) return undefined;
    return { byteLength: stat.size, sha256: parsed.sha256 };
  } catch (error) {
    if (isCode(error, "ENOENT") || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function filesystemBackend(options: { root: string }): ObjectBackend {
  const root = path.resolve(options.root);

  const read = async (at: StoredObjectAddress): Promise<AsyncIterable<Uint8Array>> => {
    const stream = createReadStream(pathsOf(root, at.key).object);
    return new Promise((resolve, reject) => {
      stream.once("error", (error) =>
        reject(
          isCode(error, "ENOENT") ? new StoredObjectNotFoundError(at.projectId, at.key) : error,
        ),
      );
      stream.once("open", () => resolve(stream));
    });
  };

  return {
    destination: { kind: "file", root },

    async write(at, body, facts) {
      const paths = pathsOf(root, at.key);
      const measured = measureBody({ at, body, facts });
      try {
        await fs.rm(paths.digest, { force: true });
        await writeAtomically(paths.object, measured.chunks);
        const digest = measured.digest();
        await writeAtomically(paths.digest, [Buffer.from(JSON.stringify(digest))]);
        return digest;
      } catch (error) {
        throw measured.failure() ?? refusedWrite(error);
      }
    },

    read,

    async digest(at) {
      const held = await heldDigest(pathsOf(root, at.key));
      return held ?? digestOf(await read(at));
    },

    async remove(at) {
      const paths = pathsOf(root, at.key);
      await fs.rm(paths.digest, { force: true });
      await fs.rm(paths.object, { force: true });
    },

    signUpload: () => Promise.resolve({ kind: "through-process" }),
    signDownload: (at) => Promise.reject(new UnsignableDownloadError("file", at.key)),

    async probe() {
      await fs.mkdir(root, { recursive: true });
      await fs.access(root, constants.R_OK | constants.W_OK);
    },
  };
}
