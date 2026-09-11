import { afterAll, describe, expect, it } from "vitest";
import { emptyCatchRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const SOURCE = "modules/agent/server/src/services/agent.service.ts";

function report(code, filename = SOURCE) {
  return runRule(emptyCatchRule, { code, cwd: workspace.cwd, filename });
}

describe("given a try statement", () => {
  describe("when the catch block is empty and takes no binding", () => {
    /** @scenario "An empty catch swallows the failure" */
    it("reports emptyCatch", () => {
      const found = report("try { await send(); } catch {}");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("emptyCatch");
      expect(found[0].data.form).toBe("catch {}");
    });
  });

  describe("when the catch block is empty and binds the error", () => {
    /** @scenario "An empty catch that binds the error still swallows it" */
    it("reports emptyCatch", () => {
      const found = report("try { await send(); } catch (error) {}");

      expect(found).toHaveLength(1);
      expect(found[0].data.form).toBe("catch (error) {}");
    });
  });

  describe("when the catch block holds only a comment", () => {
    /** @scenario "A catch holding only a comment is still empty" */
    it("reports emptyCatch", () => {
      const found = report("try { await send(); } catch (error) {\n  // best effort\n}");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("emptyCatch");
    });
  });

  describe("when the catch block rethrows", () => {
    /** @scenario "A catch that rethrows is allowed" */
    it("reports nothing", () => {
      expect(report("try { await send(); } catch (error) { throw error; }")).toEqual([]);
    });
  });

  describe("when the catch block returns a fallback", () => {
    /** @scenario "A catch that returns a fallback is allowed" */
    it("reports nothing", () => {
      expect(
        report("function read() { try { return parse(); } catch { return undefined; } }"),
      ).toEqual([]);
    });
  });
});
