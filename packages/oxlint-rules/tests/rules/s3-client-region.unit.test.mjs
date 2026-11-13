import { afterAll, describe, expect, it } from "vitest";

import { s3ClientRegionRule } from "../../src/rules/s3-client-region.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const MODULE_FILE = "modules/agent/process/src/repositories/s3/agent.s3.repository.ts";
const IMPORTS = 'import { S3Client } from "@aws-sdk/client-s3";\n';

function messageIds(code, filename = MODULE_FILE) {
  return runRule(s3ClientRegionRule, { code: IMPORTS + code, cwd: workspace.cwd, filename }).map(
    (finding) => finding.messageId,
  );
}

describe("given a module file building an S3 client", () => {
  describe("when the region is a literal", () => {
    /** @scenario "A literal region on an S3 client is reported" */
    it("reports regionNotShared", () => {
      expect(messageIds('new S3Client({ region: "auto" });')).toEqual(["regionNotShared"]);
    });
  });

  describe("when the region is a hand-written check inside a spread", () => {
    /** @scenario "A literal region on an S3 client is reported" */
    it("reports regionNotShared", () => {
      const code = `const region = endpoint ? "auto" : undefined;
new S3Client({ ...aws.build({ region, endpoint }), forcePathStyle: true });`;
      expect(messageIds(code)).toEqual(["regionNotShared"]);
    });
  });

  describe("when the client names no region at all", () => {
    /** @scenario "An S3 client with no region is reported" */
    it("reports missingRegion", () => {
      expect(messageIds("new S3Client({ endpoint });")).toEqual(["missingRegion"]);
    });
  });

  describe("when only one branch of a conditional names a region", () => {
    /** @scenario "An S3 client with a region on only one path is reported" */
    it("reports missingRegion, since the other path has none", () => {
      const conditional = "new S3Client({ ...(enabled ? { region: s3RegionOf(config) } : {}) });";
      expect(messageIds(conditional)).toEqual(["missingRegion"]);
      const guarded = "new S3Client({ ...(enabled && { region: s3RegionOf(config) }) });";
      expect(messageIds(guarded)).toEqual(["missingRegion"]);
    });
  });

  describe("when the client gets no options, or options it cannot read", () => {
    /** @scenario "An S3 client whose options the rule cannot read is reported" */
    it("reports missingRegion for none and unreadableOptions for a parameter", () => {
      expect(messageIds("new S3Client();")).toEqual(["missingRegion"]);
      expect(messageIds("function build(options) { return new S3Client(options); }")).toEqual([
        "unreadableOptions",
      ]);
    });
  });

  describe("when the options are bound to a name first", () => {
    /** @scenario "A literal region on an S3 client is reported" */
    it("reads the binding, reporting a literal and accepting the shared rule", () => {
      expect(messageIds('const options = { region: "auto" };\nnew S3Client(options);')).toEqual([
        "regionNotShared",
      ]);
      const shared = "const options = { region: s3RegionOf(config) };\nnew S3Client(options);";
      expect(messageIds(shared)).toEqual([]);
    });
  });

  describe("when a same-named region in another function comes from the shared rule", () => {
    /** @scenario "A region is judged by the binding in scope, not by its name" */
    it("checks the binding in scope, not the name", () => {
      const code = `function shared() { const region = s3RegionOf(config); return new S3Client({ region }); }
function literal() { const region = "auto"; return new S3Client({ region }); }`;
      expect(messageIds(code)).toEqual(["regionNotShared"]);
    });
  });

  describe("when the region comes from the shared rule", () => {
    /** @scenario "A region from the shared rule is accepted" */
    it("reports nothing, called inline or bound to a name first", () => {
      expect(messageIds("new S3Client({ region: s3RegionOf({ region, endpoint }) });")).toEqual([]);
      const bound = `const region = s3RegionOf({ region: config.region, endpoint });
new S3Client({ ...aws.build({ region, endpoint }) });`;
      expect(messageIds(bound)).toEqual([]);
    });
  });
});

describe("given the AWS client package", () => {
  describe("when it builds an S3 client with its own region", () => {
    /** @scenario "The AWS client package may build its own clients" */
    it("reports nothing", () => {
      expect(
        messageIds('new S3Client({ region: "auto" });', "packages/aws-client/src/s3-region.ts"),
      ).toEqual([]);
    });
  });
});
