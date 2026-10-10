// specs/upgrade/upgrade-rehearsal.feature: phase 0 product seeds and their read-back through head.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate, VERDICT } from "../evaluate.mjs";
import { PRODUCT_KINDS, readBack, seedProducts } from "../seed/product.mjs";

const seedFindings = (evidence) => evaluate(evidence).filter((f) => f.id.startsWith("SEED-"));
const byId = (findings, kind) => findings.find((f) => f.id === `SEED-${kind}`);

/** A fake old or head wire that remembers what was written and answers reads from it. */
function fakeWire({ failMutations = [], failReads = [] } = {}) {
  const written = [];
  return {
    written,
    signIn: async () => {},
    rest: async () => ({}),
    async mutate({ path, input }) {
      if (path === "onboarding.initializeOrganization") {
        return { organizationId: "org_1", teamId: "team_1", projectSlug: "p" };
      }
      if (failMutations.includes(path)) throw new Error(`${path} answered 404`);
      written.push(input);
      return {};
    },
    async query({ path }) {
      if (path === "organization.getAll") {
        return [{ teams: [{ projects: [{ id: "project_1", slug: "p" }] }] }];
      }
      if (path === "project.getProjectAPIKey") return { apiKey: "sk-lw-1" };
      if (failReads.includes(path)) throw new Error(`${path} answered 500`);
      return written;
    },
  };
}

const ctx = { email: "e", password: "p", label: "run1" };

void describe("product seeds", () => {
  /** @scenario "Product kinds seeded through the old image are read back through head" */
  void it("passes kinds head reads back and reproduces the ones it lost", async () => {
    const old = fakeWire();
    const seeds = await seedProducts({ wire: old, ctx: { ...ctx } });
    assert.equal(seeds.context.email, undefined);
    const seeded = seeds.kinds.filter((k) => k.seeded).map((k) => k.kind);
    assert.deepEqual(seeded, [
      "privacy",
      "retention",
      "annotation",
      "workflow",
      "slack",
      "report",
      "dataset",
      "evaluator",
      "prompt",
      "monitor",
      "scenario",
      "suite",
    ]);

    const head = fakeWire({ failReads: ["suites.getAll"] });
    head.written.push(...old.written.filter((input) => !/rehearsal slack/.test(input.name)));
    const readback = await readBack({ wire: head, ctx: { ...ctx }, seeds });
    const findings = seedFindings({ productSeeds: seeds, productReadback: readback });

    assert.equal(byId(findings, "report").verdict, VERDICT.notReproduced);
    assert.equal(byId(findings, "annotation").verdict, VERDICT.notReproduced);
    assert.equal(byId(findings, "slack").verdict, VERDICT.reproduced);
    const suite = byId(findings, "suite");
    assert.equal(suite.verdict, VERDICT.reproduced);
    assert.match(suite.detail, /suites\.getAll answered 500/);
  });

  /** @scenario "Product kinds seeded through the old image are read back through head" */
  void it("writes a bulk kind perKind times and counts each one head reads back", async () => {
    const old = fakeWire();
    const seeds = await seedProducts({ wire: old, ctx: { ...ctx, perKind: 3 } });
    assert.deepEqual(
      seeds.kinds.find((k) => k.kind === "dataset"),
      { kind: "dataset", seeded: true, created: 3, failed: 0 },
    );
    const head = fakeWire();
    head.written.push(...old.written.filter((input) => !/dataset run1 00002/.test(input.name)));
    const readback = await readBack({ wire: head, ctx: { ...ctx }, seeds });
    const dataset = byId(
      seedFindings({ productSeeds: seeds, productReadback: readback }),
      "dataset",
    );
    assert.equal(dataset.verdict, VERDICT.reproduced);
    assert.match(dataset.detail, /\(2 of 3\)/);
  });

  /** @scenario "A product kind with no seed or no read-back is inconclusive" */
  void it("names why a kind was not seeded and refuses missing evidence", async () => {
    const seeds = await seedProducts({
      wire: fakeWire({ failMutations: ["workflow.create"] }),
      ctx: { ...ctx },
    });
    const findings = seedFindings({ productSeeds: seeds });
    assert.equal(findings.length, PRODUCT_KINDS.length);
    for (const kind of ["licence", "sso", "coding-assistant", "workflow"]) {
      assert.equal(byId(findings, kind).verdict, VERDICT.inconclusive);
      assert.match(byId(findings, kind).detail, /not seeded: /);
    }
    assert.match(byId(findings, "workflow").detail, /workflow\.create answered 404/);
    assert.match(byId(findings, "report").detail, /product-readback\.json/);
    for (const finding of seedFindings({})) {
      assert.equal(finding.verdict, VERDICT.inconclusive);
      assert.match(finding.detail, /product-seeds\.json/);
    }
  });
});
