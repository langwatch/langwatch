/**
 * The API publishes a delivery configuration per channel so an integrator —
 * or an agent — can see from the schema alone what a Slack automation needs
 * that an email one does not. That is only worth publishing while it agrees
 * with the channel it claims to describe, which is what this holds: every
 * field the published schema names is one its channel actually reads, and no
 * field the channel requires is left out of what is published.
 */

import { describe, expect, it } from "vitest";
import type { TriggerAction } from "~/generated/prisma/client";
import { SERVER_PROVIDERS } from "~/server/app-layer/automations/providers/registry";
import { deliveryFieldNames } from "~/server/app-layer/automations/trigger-redaction";
import { PUBLIC_API_ACTION_PARAMS_SCHEMAS } from "../[[...route]]/app";

describe("Feature: the API expresses the automations the dashboard expresses", () => {
  describe("when the API's delivery schemas are read", () => {
    /** @scenario "Each channel's delivery configuration is published by name" */
    it("names the fields its channel actually reads", () => {
      for (const [action, published] of Object.entries(
        PUBLIC_API_ACTION_PARAMS_SCHEMAS,
      )) {
        const channel = SERVER_PROVIDERS[action as TriggerAction];
        // Named before it is dereferenced: without this the first failure is
        // a TypeError on `.shared`, which buries the mismatch the next
        // assertion (and the test below) would have reported plainly.
        expect(
          channel,
          `${action} is published by the API but this server offers no such channel`,
        ).toBeDefined();
        expect(
          [...deliveryFieldNames(published)].sort(),
          `the ${action} delivery configuration the API publishes`,
        ).toEqual(
          [...deliveryFieldNames(channel!.shared.actionParamsSchema)].sort(),
        );
      }
    });

    it("publishes one for every channel this server offers", () => {
      expect(Object.keys(PUBLIC_API_ACTION_PARAMS_SCHEMAS).sort()).toEqual(
        Object.keys(SERVER_PROVIDERS).sort(),
      );
    });
  });
});
