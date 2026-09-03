/**
 * The composed drawer registry, and the one way composing it can go wrong.
 *
 * `installed-ui-drawers.ts` spreads one map per feature into a single object,
 * which is what makes a feature able to own its own drawers. A spread is also
 * silent: two features that both register `promptList` leave ONE of them in the
 * registry and no error anywhere, and the reader gets whichever module happened
 * to be spread last. `platform/app` could not have this bug — one file named
 * every drawer, so a duplicate key was a duplicate key in the same object
 * literal — so it arrives with the composition and is worth pinning.
 */

import { describe, expect, it } from "vitest";

import { agentDrawers } from "../src/features/agent";
import { annotationScoresDrawers } from "../src/features/annotation-scores";
import { automationsDrawers } from "../src/features/automations";
import { datasetDrawers } from "../src/features/dataset";
import { evaluatorDrawers } from "../src/features/evaluator";
import { experimentDrawers } from "../src/features/experiments";
import { gatewayDrawers } from "../src/features/gateway";
import { installedUiDrawers } from "../src/features/installed-ui-drawers";
import { modelProviderDrawers } from "../src/features/model-provider";
import { opsDrawers } from "../src/features/ops";
import { organizationDrawers } from "../src/features/organization";
import { projectDrawers } from "../src/features/project";
import { promptDrawers } from "../src/features/prompt";
import { simulationsDrawers } from "../src/features/simulations";
import { traceDrawers } from "../src/features/traces";
import { workflowDrawers } from "../src/features/workflows";

const perFeature = [
  agentDrawers,
  annotationScoresDrawers,
  automationsDrawers,
  datasetDrawers,
  evaluatorDrawers,
  experimentDrawers,
  gatewayDrawers,
  modelProviderDrawers,
  opsDrawers,
  organizationDrawers,
  projectDrawers,
  promptDrawers,
  simulationsDrawers,
  traceDrawers,
  workflowDrawers,
];

describe("the installed drawer registry", () => {
  describe("given every feature's own drawer map", () => {
    describe("when they are composed", () => {
      it("keeps all of them, so no feature's drawer is silently shadowed", () => {
        const declared = perFeature.reduce(
          (total, feature) => total + Object.keys(feature).length,
          0,
        );

        expect(Object.keys(installedUiDrawers)).toHaveLength(declared);
      });
    });
  });

  describe("given a registered drawer", () => {
    describe("when the host resolves it", () => {
      it("is something React can mount", () => {
        for (const [name, drawer] of Object.entries(installedUiDrawers)) {
          expect(
            typeof drawer === "function" || typeof drawer === "object",
            `${name} is not a component`,
          ).toBe(true);
        }
      });
    });
  });
});
