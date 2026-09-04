/**
 * The composed drawer registry, and the one way composing it can go wrong.
 *
 * `installed-ui-features.ts` merges one map per feature into a single
 * object, which is what makes a feature able to own its own drawers. A
 * silent spread would leave two features that both register `promptList`
 * with ONE of them in the registry and no error anywhere, and the reader
 * gets whichever module happened to be spread last. `platform/app` could
 * not have this bug — one file named every drawer, so a duplicate key was a
 * duplicate key in the same object literal — so it arrives with the
 * composition and is worth pinning.
 */

import { describe, expect, it } from "vitest";

import { agentFeature } from "../src/features/agent";
import { annotationScoresFeature } from "../src/features/annotation-scores";
import { automationsFeature } from "../src/features/automations";
import { datasetFeature } from "../src/features/dataset";
import { evaluatorFeature } from "../src/features/evaluator";
import { experimentsFeature } from "../src/features/experiments";
import { gatewayFeature } from "../src/features/gateway";
import { installedUiDrawers } from "../src/features/installed-ui-features";
import { modelProviderFeature } from "../src/features/model-provider";
import { opsFeature } from "../src/features/ops";
import { organizationFeature } from "../src/features/organization";
import { projectFeature } from "../src/features/project";
import { promptFeature } from "../src/features/prompt";
import { simulationsFeature } from "../src/features/simulations";
import { traceFeature } from "../src/features/traces";
import { workflowFeature } from "../src/features/workflows";

const perFeature = [
  agentFeature,
  annotationScoresFeature,
  automationsFeature,
  datasetFeature,
  evaluatorFeature,
  experimentsFeature,
  gatewayFeature,
  modelProviderFeature,
  opsFeature,
  organizationFeature,
  projectFeature,
  promptFeature,
  simulationsFeature,
  traceFeature,
  workflowFeature,
].map((feature) => feature.drawers);

describe("the installed drawer registry", () => {
  describe("given every feature's own drawer map", () => {
    describe("when they are composed", () => {
      it("keeps all of them, so no feature's drawer is silently shadowed", () => {
        const declared = perFeature.reduce(
          (total, drawers) => total + Object.keys(drawers).length,
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
