import { afterAll, describe, expect, it } from "vitest";
import { restPathParamIsSemanticRule } from "../../src/rules/rest-path-param-is-semantic.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename = "modules/agent/process/src/transport/agent.rest.ts") {
  return runRule(restPathParamIsSemanticRule, { code, cwd: workspace.cwd, filename });
}

describe("given a path parameter that names its entity", () => {
  /** @scenario "A path parameter carrying the entity it identifies is compliant" */
  it("reports nothing", () => {
    expect(report('router.get("/:agentId", "getAgent").handle(() => 1);')).toEqual([]);
  });

  /** @scenario "A path parameter that is not an identifier at all is compliant" */
  it("leaves non-identifying segments alone", () => {
    expect(report('router.get("/:tag/versions/:version", "listByTag").handle(() => 1);')).toEqual(
      [],
    );
  });
});

describe("given a bare path parameter", () => {
  /** @scenario "A path parameter named id is reported with the entity-qualified fix" */
  it("names the entity from the preceding segment", () => {
    const found = report('router.get("/teams/:id", "getTeam").handle(() => 1);');

    expect(found.map((entry) => entry.messageId)).toEqual(["barePathParam"]);
    expect(found[0].data.name).toBe("id");
    expect(found[0].data.suggestion).toBe("teamId");
  });

  /** @scenario "A bare path parameter on a namespaced collection root is named from the namespace" */
  it("takes the entity from the router's own namespace", () => {
    const found = report(
      'defineRestRouter(X).withNamespace("agents").patch("/:id", "updateAgent").handle(() => 1);',
    );

    expect(found.map((entry) => entry.messageId)).toEqual(["barePathParam"]);
    expect(found[0].data.suggestion).toBe("agentId");
  });

  /** @scenario "A bare path parameter with no namespace and no preceding segment is still reported" */
  it("falls back to a generic entity name when nothing names the entity", () => {
    const found = report('router.patch("/:id", "updateAgent").handle(() => 1);');

    expect(found[0].data.suggestion).toBe("<entity>Id");
  });

  /** @scenario "A kebab-case collection segment yields a camelCase entity name" */
  it("camel-cases and singularises the segment", () => {
    const found = report('router.get("/virtual-keys/:id", "getVirtualKey").handle(() => 1);');

    expect(found[0].data.suggestion).toBe("virtualKeyId");
  });

  /** @scenario "Every bare parameter in one path is reported" */
  it("reports each bare parameter separately", () => {
    const found = report('router.get("/files/:projectId/:id", "readBytes").handle(() => 1);');

    expect(found.map((entry) => entry.data.name)).toEqual(["id"]);
    expect(found[0].data.suggestion).toBe("fileId");
  });

  /** @scenario "A path parameter named slug or name is reported like id" */
  it("reports the other bare spellings", () => {
    const slug = report('router.get("/datasets/:slug", "getDataset").handle(() => 1);');
    const name = report('router.get("/providers/:name", "getProvider").handle(() => 1);');

    expect(slug.map((entry) => entry.messageId)).toEqual(["barePathParam"]);
    expect(name.map((entry) => entry.messageId)).toEqual(["barePathParam"]);
  });
});

describe("given a file that is not a REST transport", () => {
  /** @scenario "A bare parameter outside a REST transport is not this rule's business" */
  it("reports nothing", () => {
    const found = report(
      'router.get("/teams/:id", "getTeam").handle(() => 1);',
      "modules/agent/process/src/services/agent.service.ts",
    );

    expect(found).toEqual([]);
  });
});
