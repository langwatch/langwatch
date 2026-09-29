/**
 * The hosted services Settings, Connect lists.
 *
 * The statement of what leaves the install is on the page before the switch is
 * touched, so it is pinned here rather than left to whoever edits the section
 * next.
 *
 * Spec: specs/self-hosting/connected-services/managed-models-provider.feature
 *       specs/self-hosting/connected-services/connect-settings.feature
 */

import { CONNECT_SERVICES } from "@ee/licensing/connect/services";
import { describe, expect, it } from "vitest";
import { HOSTED_SERVICES } from "../connectStatus";

describe("the hosted services catalog", () => {
  describe("given an admin opens the page", () => {
    /** @scenario Managed models is listed in Settings, Connect with what it sends */
    it("lists managed models and states what leaves the install for it", () => {
      const managedModels = HOSTED_SERVICES.find(
        (service) => service.id === "managed_models",
      );

      expect(managedModels?.name).toBe("Managed models");
      expect(managedModels?.dataStatements).toEqual([
        "The prompts and completions of calls you route to a langwatch model are sent to LangWatch.",
        "Calls to your own providers are unaffected and are never sent.",
        "Traces, prompts and datasets are never sent.",
      ]);
    });
  });

  it("names every service the license registry can entitle", () => {
    expect(HOSTED_SERVICES.map((service) => service.id).sort()).toEqual(
      [...CONNECT_SERVICES].sort(),
    );
  });
});
