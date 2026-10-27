import { readdirSync, statSync } from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

const COMPONENTS = path.resolve(import.meta.dirname, "../src/components");

const isStory = (name: string) => name.endsWith(".stories.tsx");
const isComponent = (name: string) => name.endsWith(".tsx") && !isStory(name);

/**
 * A family directory (icons, messages: it has an index.ts) is documented by one
 * story named after it; thirteen vendor marks as thirteen entries bury the rest.
 * A concern folder (forms, overlays) holds components each with its own story.
 */
function directoriesIn(dir: string): string[] {
  return readdirSync(dir).filter((entry) => statSync(path.join(dir, entry)).isDirectory());
}

function filesIn(dir: string): string[] {
  return readdirSync(dir).filter((entry) => statSync(path.join(dir, entry)).isFile());
}

const isFamily = (dir: string) => filesIn(path.join(COMPONENTS, dir)).includes("index.ts");
const concernFolders = [
  COMPONENTS,
  ...directoriesIn(COMPONENTS)
    .filter((dir) => !isFamily(dir))
    .map((dir) => path.join(COMPONENTS, dir)),
];

describe("the design system component catalogue", () => {
  describe("given the components the package publishes", () => {
    /** @scenario "Every exported component has a story" */
    it("finds a story file beside every component file", () => {
      const entries = concernFolders.flatMap((dir) =>
        filesIn(dir)
          .filter(isComponent)
          .map((file) => path.join(dir, file)),
      );

      const undocumented = entries.filter(
        (file) =>
          !filesIn(path.dirname(file)).includes(
            path.basename(file).replace(/\.tsx$/, ".stories.tsx"),
          ),
      );

      expect(entries.length).toBeGreaterThan(0);
      expect(undocumented).toEqual([]);
    });

    /** @scenario "Every exported component has a story" */
    it("finds one story file for every directory of components", () => {
      const directories = directoriesIn(COMPONENTS).filter(isFamily);
      const undocumented = directories.filter(
        (dir) => !filesIn(path.join(COMPONENTS, dir)).includes(`${dir}.stories.tsx`),
      );

      expect(directories.length).toBeGreaterThan(0);
      expect(undocumented).toEqual([]);
    });
  });
});
