import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chmod = vi.hoisted(() => ({ refuse: false }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof fs>();
  const chmodSync: typeof real.chmodSync = (...args) => {
    if (chmod.refuse) throw new Error("EPERM: operation not permitted");
    return real.chmodSync(...args);
  };
  return { ...real, chmodSync };
});

import { writeSecretFile } from "../secret-file";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-secret-file-"));
});
afterEach(() => {
  chmod.refuse = false;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeSecretFile", () => {
  describe("when the file is new", () => {
    it.skipIf(process.platform === "win32")("creates it readable by its owner only", () => {
      const file = path.join(dir, "settings.json");
      writeSecretFile(file, "token");

      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(file, "utf8")).toBe("token");
    });
  });

  describe("when the file exists readable by everyone", () => {
    it.skipIf(process.platform === "win32")(
      "narrows it to its owner and replaces the content",
      () => {
        const file = path.join(dir, ".zshrc");
        fs.writeFileSync(file, "old", { mode: 0o644 });
        fs.chmodSync(file, 0o644);

        writeSecretFile(file, "new");

        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.readFileSync(file, "utf8")).toBe("new");
      },
    );
  });

  describe("when the file system refuses to change the mode", () => {
    /** @scenario "A file system that refuses chmod still gets the write" */
    it("still writes the content and warns that the file is not private", () => {
      const file = path.join(dir, "config.toml");
      fs.writeFileSync(file, "old");
      chmod.refuse = true;
      const warn = vi.fn();

      writeSecretFile(file, "new", warn);

      expect(fs.readFileSync(file, "utf8")).toBe("new");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("EPERM"));
      expect(warn.mock.calls[0]![0]).toContain(file);
    });
  });
});
