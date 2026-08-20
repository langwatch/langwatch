import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classify,
  isDependencyBot,
  kindOf,
  parseChangedFiles,
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

describe("given a path with unusual but legal whitespace", () => {
  describe("when a name ends in a space", () => {
    it("does not let it borrow a lockfile's exemption", () => {
      // "Chart.lock " is a different file from "Chart.lock". Trimming the two
      // together would exempt a PR that changed an unrecognised file.
      assert.equal(kindOf("charts/gateway/Chart.lock "), "other");
      assert.equal(
        requiresWriteup({ files: ["charts/gateway/Chart.lock "], author: BOT }),
        true,
      );
    });
  });

  describe("when a name contains a newline", () => {
    it("classifies it whole rather than as two records", () => {
      // Line-delimited transport would split this into "evil" and
      // "uv.lock"; the second half alone would look exempt.
      assert.equal(kindOf("services/evil\nuv.lock"), "other");
      assert.equal(
        requiresWriteup({ files: ["services/evil\nuv.lock"], author: BOT }),
        true,
      );
    });
  });
});

describe("given the JSON the workflow hands the guard", () => {
  describe("when it is well-formed paginated output", () => {
    it("flattens the pages and keeps every name byte-exact", () => {
      const json = JSON.stringify([
        [{ filename: "services/langevals/uv.lock" }],
        [{ filename: "charts/gateway/Chart.lock " }],
      ]);
      assert.deepEqual(parseChangedFiles(json), [
        "services/langevals/uv.lock",
        "charts/gateway/Chart.lock ",
      ]);
    });
  });

  describe("when it is malformed", () => {
    it("throws rather than waving the pull request through", () => {
      assert.throws(() => parseChangedFiles("not json"), /did not parse/);
      assert.throws(() => parseChangedFiles('{"files":[]}'), /not an array/);
      assert.throws(
        () => parseChangedFiles(JSON.stringify([[{ sha: "abc" }]])),
        /no usable filename/,
      );
      assert.throws(
        () => parseChangedFiles(JSON.stringify([[{ filename: "" }]])),
        /no usable filename/,
      );
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
