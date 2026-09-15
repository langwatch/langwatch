import { readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const COMPONENTS = path.resolve(import.meta.dirname, "../src/components");

const isStory = (name: string) => name.endsWith(".stories.tsx");
const isComponent = (name: string) => name.endsWith(".tsx") && !isStory(name);

/**
 * A directory of components (icons, messages) is documented by one story for
 * the whole directory, named after it. Documenting thirteen vendor marks as
 * thirteen entries buries the rest of the catalogue.
 */
function directoriesIn(dir: string): string[] {
  return readdirSync(dir).filter((entry) => statSync(path.join(dir, entry)).isDirectory());
}

function filesIn(dir: string): string[] {
  return readdirSync(dir).filter((entry) => statSync(path.join(dir, entry)).isFile());
}

describe("the design system component catalogue", () => {
  describe("given the components the package publishes", () => {
    /** @scenario "Every exported component has a story" */
    it("finds a story file beside every component file", () => {
      const entries = filesIn(COMPONENTS).filter(isComponent);
      const stories = new Set(filesIn(COMPONENTS).filter(isStory));

      const undocumented = entries.filter(
        (file) => !stories.has(`${file.replace(/\.tsx$/, "")}.stories.tsx`),
      );

      expect(entries.length).toBeGreaterThan(0);
      expect(undocumented).toEqual([]);
    });

    /** @scenario "Every exported component has a story" */
    it("finds one story file for every directory of components", () => {
      const directories = directoriesIn(COMPONENTS);
      const undocumented = directories.filter(
        (dir) => !filesIn(path.join(COMPONENTS, dir)).includes(`${dir}.stories.tsx`),
      );

      expect(directories.length).toBeGreaterThan(0);
      expect(undocumented).toEqual([]);
    });
  });
});
