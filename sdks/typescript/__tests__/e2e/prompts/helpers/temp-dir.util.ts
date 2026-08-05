import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const TempDirUtil = {
  /**
   * Creates and cleans up a temporary directory.
   */
  withTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "langwatch-examples-"));
    return {
      dir,
      dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
  },
};

