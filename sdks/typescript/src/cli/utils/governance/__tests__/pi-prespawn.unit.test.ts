import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PI_MIN_VERSION,
  parsePiVersion,
  piPrespawnWarnings,
  readInstalledVersion,
} from "../pi-prespawn";

describe("piPrespawnWarnings()", () => {
  describe("when the installed pi is older than the minimum", () => {
    /** @scenario An installed pi below the minimum version gets a warning and the run continues */
    it("warns once, naming the installed and the minimum version", () => {
      const warnings = piPrespawnWarnings({ readVersionImpl: () => "0.80.4" });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("pi 0.80.4");
      expect(warnings[0]).toContain(PI_MIN_VERSION);
    });
  });

  describe("when the installed pi is at or above the minimum", () => {
    it.each([PI_MIN_VERSION, "0.84.2", "1.0.0"])("does not warn for %s", (version) => {
      expect(piPrespawnWarnings({ readVersionImpl: () => version })).toEqual([]);
    });
  });

  describe("when the version cannot be read", () => {
    it("does not warn", () => {
      expect(piPrespawnWarnings({ readVersionImpl: () => null })).toEqual([]);
    });
  });
});

describe("readInstalledVersion()", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-pi-version-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A stand-in pi at `file` that prints `version`. */
  const plantPi = (file: string, version: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  };

  it("reads the pi on PATH", () => {
    plantPi(path.join(dir, "bin", "pi"), "0.84.2");
    const env = { PATH: [path.join(dir, "bin"), "/bin", "/usr/bin"].join(path.delimiter) };

    expect(readInstalledVersion({ env })).toBe("0.84.2");
  });

  it.skipIf(!fs.existsSync("/bin/bash"))(
    "reads a pi only the shell's alias reaches, ignoring what the rc prints",
    () => {
      const hidden = path.join(dir, "hidden", "pi");
      plantPi(hidden, "0.79.1");
      fs.writeFileSync(
        path.join(dir, ".bashrc"),
        `echo "Now using node v24.22.1"\nalias pi='${hidden}'\n`,
      );
      const env = { HOME: dir, SHELL: "/bin/bash", PATH: ["/bin", "/usr/bin"].join(":") };

      expect(readInstalledVersion({ env })).toBe("0.79.1");
    },
  );

  it("returns null when no pi resolves at all", () => {
    const env = { HOME: dir, SHELL: "/bin/sh", PATH: path.join(dir, "empty") };

    expect(readInstalledVersion({ env })).toBeNull();
  });
});

describe("parsePiVersion()", () => {
  it("reads the bare version pi prints", () => {
    expect(parsePiVersion("0.84.2\n")).toBe("0.84.2");
  });

  it("returns null for output with no version", () => {
    expect(parsePiVersion("pi: command not found")).toBeNull();
    expect(parsePiVersion(null)).toBeNull();
  });
});
