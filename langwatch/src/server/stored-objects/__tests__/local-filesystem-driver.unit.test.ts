/**
 * @vitest-environment node
 *
 * Unit tests for LocalFilesystemDriver.
 *
 * Each test gets an isolated temporary directory that is cleaned up in afterEach
 * to avoid cross-test interference.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ObjectNotFoundError } from "../errors";
import { LocalFilesystemDriver } from "../local-filesystem-driver";
import { mintFileUri } from "../uri";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Accumulate all bytes from a Readable stream into a Buffer. */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;
let driver: LocalFilesystemDriver;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `lw-fs-driver-${randomBytes(6).toString("hex")}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
  driver = new LocalFilesystemDriver();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// put
// ---------------------------------------------------------------------------

describe("when put is called with bytes and a file URI", () => {
  /** @scenario "Local filesystem driver writes under the configured root using atomic rename" */
  it("writes the bytes to the final path", async () => {
    const uri = mintFileUri({
      root: tmpDir,
      projectId: "proj-abc",
      sha256: "deadbeef1234",
    });
    const content = Buffer.from("hello world");

    await driver.put(uri, content, "text/plain");

    const finalPath = path.join(tmpDir, "proj-abc", "deadbeef1234");
    const written = await fs.readFile(finalPath);
    expect(written).toEqual(content);
  });

  it("creates intermediate directories", async () => {
    // URI with a deeply-nested structure: root / projectId / sha
    const deepRoot = path.join(tmpDir, "a", "b", "c");
    const uri = mintFileUri({
      root: deepRoot,
      projectId: "proj-xyz",
      sha256: "cafebabe9999",
    });
    const content = Buffer.from("nested content");

    await driver.put(uri, content, "application/octet-stream");

    const finalPath = path.join(deepRoot, "proj-xyz", "cafebabe9999");
    const written = await fs.readFile(finalPath);
    expect(written).toEqual(content);
  });
});

// ---------------------------------------------------------------------------
// Atomicity invariant
// ---------------------------------------------------------------------------

describe("when put writes a temporary file first", () => {
  it("does not leave a .tmp.* file at the final path after a successful rename", async () => {
    const uri = mintFileUri({
      root: tmpDir,
      projectId: "proj-atomic",
      sha256: "atomicsha256",
    });

    await driver.put(uri, Buffer.from("atomic bytes"), "application/octet-stream");

    const dir = path.join(tmpDir, "proj-atomic");
    const entries = await fs.readdir(dir);
    const tmpFiles = entries.filter((e) => e.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Atomicity-under-interruption scenario
//
// This is a "regression-flavored" test that verifies the observable invariant
// (no torn file at <final> after an aborted-write state), not the literal
// kernel-level atomicity of rename(2). Simulating a literal mid-rename
// interruption is not feasible in a unit test without OS-level hooks.
//
// The scenario:
//   1. A previous write was interrupted after creating the .tmp file but
//      before rename completed. The .tmp file is orphaned on disk.
//   2. The final path does NOT exist (no torn bytes).
//   3. A retry via driver.put converges to a complete file at <final>.
// ---------------------------------------------------------------------------

describe("Local filesystem driver write is atomic under interruption", () => {
  /** @scenario "Local filesystem driver write is atomic under interruption" */
  it("converges to a complete file when retried after an interrupted write", async () => {
    const projectId = "proj-interrupted";
    const sha256 = "interruptedsha256";
    const uri = mintFileUri({ root: tmpDir, projectId, sha256 });
    const dir = path.join(tmpDir, projectId);
    const finalPath = path.join(dir, sha256);

    // Simulate the interrupted-write state: an orphaned .tmp file exists but
    // the final path does not.
    await fs.mkdir(dir, { recursive: true });
    const orphanedTmp = `${finalPath}.tmp.orphaned`;
    await fs.writeFile(orphanedTmp, Buffer.from("partial/torn bytes"));

    // Pre-condition: final path must not exist.
    await expect(fs.access(finalPath)).rejects.toThrow();

    // Retry: driver.put must converge to a complete file.
    const expectedContent = Buffer.from("complete bytes");
    await driver.put(uri, expectedContent, "application/octet-stream");

    // Post-condition: final path exists with the correct content.
    const written = await fs.readFile(finalPath);
    expect(written).toEqual(expectedContent);
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("when get is called and the file exists", () => {
  it("streams the bytes", async () => {
    const uri = mintFileUri({
      root: tmpDir,
      projectId: "proj-get",
      sha256: "getsha256",
    });
    const content = Buffer.from("stream me back");
    await driver.put(uri, content, "application/octet-stream");

    const stream = await driver.get(uri);
    const result = await streamToBuffer(stream);
    expect(result).toEqual(content);
  });
});

describe("when get is called and the file does not exist", () => {
  it("throws ObjectNotFoundError", async () => {
    const uri = mintFileUri({
      root: tmpDir,
      projectId: "proj-missing",
      sha256: "missingsha256",
    });

    await expect(driver.get(uri)).rejects.toThrow(ObjectNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe("when exists is called and the file is present", () => {
  it("returns true", async () => {
    const uri = mintFileUri({
      root: tmpDir,
      projectId: "proj-exists",
      sha256: "existssha256",
    });
    await driver.put(uri, Buffer.from("present"), "text/plain");

    expect(await driver.exists(uri)).toBe(true);
  });
});

describe("when exists is called and the file is missing", () => {
  it("returns false", async () => {
    const uri = mintFileUri({
      root: tmpDir,
      projectId: "proj-no-exist",
      sha256: "noexistsha256",
    });

    expect(await driver.exists(uri)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("when delete is called and the file exists", () => {
  it("removes it", async () => {
    const uri = mintFileUri({
      root: tmpDir,
      projectId: "proj-del",
      sha256: "delsha256",
    });
    await driver.put(uri, Buffer.from("delete me"), "text/plain");

    await driver.delete(uri);

    expect(await driver.exists(uri)).toBe(false);
  });
});

describe("when delete is called and the file does not exist", () => {
  it("is a no-op", async () => {
    const uri = mintFileUri({
      root: tmpDir,
      projectId: "proj-del-noexist",
      sha256: "delnoexistsha256",
    });

    // Must not throw.
    await expect(driver.delete(uri)).resolves.toBeUndefined();
  });
});
