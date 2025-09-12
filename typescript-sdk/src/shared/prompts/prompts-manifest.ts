import * as fs from "fs";

/**
 * Handles prompts.json manifest operations
 */
export class PromptsManifest {
  static MANIFEST_FILE = "prompts.json";

  /**
   * Resolves a prompt handle to its file path if it's a local file dependency
   * Returns null for remote dependencies or if handle doesn't exist
   */
  static getPath(handle: string): string | null {
    try {
      const manifestContent = fs.readFileSync(PromptsManifest.MANIFEST_FILE, "utf-8");
      const config = JSON.parse(manifestContent);
      const dependency = config.prompts?.[handle];

      // Only handle string format: "file:path/to/file.yaml"
      if (typeof dependency === "string" && dependency.startsWith("file:")) {
        return dependency.slice(5); // Remove "file:" prefix
      }

      // Remote dependency or other format
      return null;
    } catch {
      // File doesn't exist or can't be parsed
      return null;
    }
  }
}
