import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classify,
  isDependencyBot,
  kindOf,
  requiresWriteup,
} from "./guard-deployment-impact.ts";

const BOT = "dependabot[bot]";
const HUMAN = "0xdeafcafe";

describe("given the changed files of a pull request", () => {
  describe("when a path is an auto-generated lockfile", () => {
    it("reads it as a lockfile wherever it sits in the tree", () => {
      assert.equal(kindOf("services/langevals/uv.lock"), "lockfile");
      assert.equal(kindOf("pnpm-lock.yaml"), "lockfile");
      assert.equal(kindOf("charts/gateway/Chart.lock"), "lockfile");
      assert.equal(kindOf("services/nlpgo/go.sum"), "lockfile");
    });
  });

  describe("when a path is a hand-edited dependency manifest", () => {
    it("reads it as a manifest, including versioned requirements files", () => {
      assert.equal(kindOf("services/langevals/pyproject.toml"), "manifest");
      assert.equal(kindOf("go.mod"), "manifest");
      assert.equal(kindOf("services/foo/requirements-dev.txt"), "manifest");
    });
  });

  describe("when a path is neither", () => {
    it("reads it as other, so no exemption can rest on it", () => {
      assert.equal(kindOf("charts/gateway/values.yaml"), "other");
      assert.equal(kindOf("dev/docs/adr/045-domain-errors.md"), "other");
      // A directory that merely ends in a manifest's name is not that manifest.
      assert.equal(kindOf("tools/package.json/notes.md"), "other");
    });
  });

  describe("when the change set is empty", () => {
    it("claims neither exemption rather than passing vacuously", () => {
      assert.deepEqual(classify([]), {
        onlyLockfiles: false,
        onlyManifests: false,
      });
      assert.equal(requiresWriteup({ files: [], author: BOT }), true);
    });
  });
});

describe("given a pull request the deployment-impact check would normally gate", () => {
  describe("when a dependency bot changed only auto-generated lockfiles", () => {
    /** @scenario "A dependency bot's PR touches only auto-generated lockfiles" */
    it("exempts it, because a lockfile has no deployment surface", () => {
      const files = ["services/langevals/uv.lock", "pnpm-lock.yaml"];
      assert.equal(classify(files).onlyLockfiles, true);
      assert.equal(requiresWriteup({ files, author: BOT }), false);
    });

    it("exempts a human's lockfile-only PR on the same reasoning", () => {
      const files = ["charts/gateway/Chart.lock"];
      assert.equal(requiresWriteup({ files, author: HUMAN }), false);
    });
  });

  describe("when a dependency bot changed hand-edited manifests", () => {
    /** @scenario "A dependency bot's PR touches only hand-edited dependency manifests" */
    it("exempts it, because the bot writes nothing but version bumps", () => {
      const files = ["services/langevals/pyproject.toml", "services/langevals/uv.lock"];
      assert.equal(classify(files).onlyLockfiles, false);
      assert.equal(classify(files).onlyManifests, true);
      assert.equal(requiresWriteup({ files, author: BOT }), false);
    });
  });

  describe("when a human changed hand-edited manifests", () => {
    /** @scenario "A human's PR touches only hand-edited dependency manifests" */
    it("still requires a writeup, because a manifest edit can carry more than a bump", () => {
      const files = ["package.json"];
      assert.equal(classify(files).onlyManifests, true);
      assert.equal(requiresWriteup({ files, author: HUMAN }), true);
    });
  });

  describe("when any changed file is neither a lockfile nor a manifest", () => {
    /** @scenario "A PR touches a file that isn't a recognized dependency manifest" */
    it("still requires a writeup, whoever opened it", () => {
      const files = ["services/langevals/uv.lock", "charts/gateway/values.yaml"];
      assert.deepEqual(classify(files), {
        onlyLockfiles: false,
        onlyManifests: false,
      });
      assert.equal(requiresWriteup({ files, author: BOT }), true);
      assert.equal(requiresWriteup({ files, author: HUMAN }), true);
    });
  });
});

describe("given the author of a pull request", () => {
  describe("when the login is a known dependency bot", () => {
    it("grants the manifest exemption", () => {
      assert.equal(isDependencyBot("dependabot[bot]"), true);
      assert.equal(isDependencyBot("renovate[bot]"), true);
    });
  });

  describe("when the login merely resembles one", () => {
    it("withholds it, because the match is exact", () => {
      assert.equal(isDependencyBot("dependabot"), false);
      assert.equal(isDependencyBot("not-dependabot[bot]"), false);
    });
  });
});
