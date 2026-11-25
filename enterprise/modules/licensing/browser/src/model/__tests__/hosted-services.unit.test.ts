/**
 * @see specs/self-hosting/connected-services/managed-models-provider.feature
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
import { CONNECT_SERVICES } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import { HOSTED_SERVICES } from "../hosted-services.ts";

describe("the hosted services Settings, Connect lists", () => {
  /** @scenario "Managed models is listed in Settings, Connect with what it sends" */
  it("lists managed models and states what leaves the install for it", () => {
    const managedModels = HOSTED_SERVICES.find((service) => service.id === "managed_models");

    expect(managedModels?.name).toBe("Managed models");
    expect(managedModels?.dataStatements).toEqual([
      "The prompts and completions of calls you route to a langwatch model are sent to LangWatch.",
      "Calls to your own providers are unaffected and are never sent.",
      "Traces, prompts and datasets are never sent.",
    ]);
  });

  it("names every service the license registry can entitle", () => {
    expect(HOSTED_SERVICES.map((service) => service.id).toSorted()).toEqual(
      [...CONNECT_SERVICES].toSorted(),
    );
  });
});
