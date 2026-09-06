import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { listNativeSkills, renderSkill } from "../_compiler/native.js";

// Backs specs/analytics/lwql-langy-authoring.feature: the chart family's
// discoverability for Langy — the CLI command listing (built from
// feature-map.json), the lwql-charts skill's schema-first instruction, and
// the committed compiled render staying true to its source.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(skillsRoot, "..");

describe("the lwql-charts skill and the chart command family", () => {
  describe("given the CLI's command listing source and the compiled skill tree", () => {
    /** @scenario "The chart family is discoverable by name, and its skill teaches Langy to check the schema first" */
    it("lists the chart group, teaches schema discovery before SQL, and the committed render matches a fresh one", () => {
      // The chart group appears in the command listing: `langwatch commands`
      // reads feature-map.json (embedded at codegen time), so the map is the
      // listing's source of truth.
      const featureMap = JSON.parse(
        fs.readFileSync(path.join(repoRoot, "feature-map.json"), "utf8"),
      ) as {
        features: {
          surfaces?: { code?: { cli?: string[] | null } | null } | null;
        }[];
      };
      const cliCommands = featureMap.features.flatMap(
        (feature) => feature.surfaces?.code?.cli ?? [],
      );
      const chartCommands = cliCommands.filter((command) =>
        command.startsWith("chart "),
      );
      expect(chartCommands).toContain("chart create");
      expect(chartCommands).toContain("chart place");
      expect(chartCommands).toContain("chart schema");

      // The skill instructs discovering the analytics schema before writing
      // SQL: the schema step must come before the SQL-authoring step, and
      // must forbid guessing names.
      const skill = listNativeSkills(skillsRoot).find(
        (s) => s.slug === "lwql-charts",
      );
      expect(skill, "lwql-charts is a shipped native skill").toBeTruthy();
      const rendered = renderSkill(skill!);
      const schemaStep = rendered.indexOf("langwatch chart schema");
      const sqlStep = rendered.indexOf("Write the SQL");
      expect(schemaStep, "the skill names the schema command").toBeGreaterThan(0);
      expect(sqlStep, "the skill has a SQL-writing step").toBeGreaterThan(0);
      expect(schemaStep, "schema discovery comes before SQL").toBeLessThan(sqlStep);
      expect(rendered).toContain("Never guess dataset or column names");

      // The compiled skill committed in the repository matches a fresh
      // render from its source, and the langyagent mirror carries the same
      // bytes.
      const committed = fs.readFileSync(
        path.join(skillsRoot, "_compiled", "native", "lwql-charts", "SKILL.md"),
        "utf8",
      );
      const mirrored = fs.readFileSync(
        path.join(
          repoRoot,
          "services",
          "langyagent",
          "internal",
          "assets",
          "skills",
          "lwql-charts",
          "SKILL.md",
        ),
        "utf8",
      );
      expect(committed).toBe(rendered);
      expect(mirrored).toBe(committed);
    });
  });
});
