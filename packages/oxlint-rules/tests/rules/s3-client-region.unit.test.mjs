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
