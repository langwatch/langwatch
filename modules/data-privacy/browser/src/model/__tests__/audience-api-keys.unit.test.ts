import type { DataPrivacyAudienceOptions } from "@langwatch/data-privacy-contract";
import { describe, expect, it } from "vitest";

import { apiKeySaveConfirmation, combineSaveConfirmations } from "../audience-api-keys.ts";
import { describeAudienceSelection } from "../data-privacy-labels.ts";
import { EMPTY_AUDIENCE_FORM } from "../data-privacy-rule-config.ts";

const OPTIONS: DataPrivacyAudienceOptions = {
  groups: [],
  apiKeys: [
    { id: "key-agent", name: "Trace analysis agent" },
    { id: "key-nightly", name: "Nightly eval runner" },
  ],
  canAddApiKeys: true,
};

const restrictInputTo = (apiKeyIds: string[]) => ({
  categories: {
    input: { disposition: "restrict" as const, audience: { admins: true, apiKeyIds } },
  },
});

describe("apiKeySaveConfirmation", () => {
  /** @scenario Saving a rule that adds a key asks first */
  it("asks before a save lets a key read restricted content, naming the key", () => {
    const asks = apiKeySaveConfirmation({
      before: restrictInputTo([]),
      after: restrictInputTo(["key-agent"]),
      options: OPTIONS,
    });
    expect(asks?.title).toBe("Let an API key read restricted content?");
    expect(asks?.description).toContain("Trace analysis agent");
    expect(asks?.description).toContain("as Admins do");
    expect(asks?.description).toContain("until the key expires or is revoked");
  });

  /** @scenario Saving a rule that adds a key asks first */
  it("asks nothing when the rule already named every key", () => {
    expect(
      apiKeySaveConfirmation({
        before: restrictInputTo(["key-agent"]),
        after: restrictInputTo(["key-agent"]),
        options: OPTIONS,
      }),
    ).toBeNull();
  });
});

describe("combineSaveConfirmations", () => {
  const price = {
    title: "Turn on Strict?",
    description: "Strict is priced.",
    confirmLabel: "Turn on Strict",
  };
  const key = {
    title: "Let an API key read restricted content?",
    description: "The key reads it.",
    confirmLabel: "Save and let it read",
  };

  it("asks one question naming both when a save turns on Strict and adds a key", () => {
    expect(combineSaveConfirmations(price, key)).toEqual({
      title: "Let an API key read restricted content?",
      description: "Strict is priced. The key reads it.",
      confirmLabel: "Save",
    });
  });

  it("asks the one that applies, or nothing", () => {
    expect(combineSaveConfirmations(price, null)).toEqual(price);
    expect(combineSaveConfirmations(null, key)).toEqual(key);
    expect(combineSaveConfirmations(null, null)).toBeNull();
  });
});

describe("describeAudienceSelection with keys", () => {
  it("names each picked key", () => {
    expect(
      describeAudienceSelection(
        { ...EMPTY_AUDIENCE_FORM, admins: true, apiKeyIds: ["key-agent", "key-gone"] },
        OPTIONS,
      ),
    ).toBe("Visible to: Admins, API key Trace analysis agent, an API key no longer live");
  });

  /** @scenario The picker says when the API keys could not be loaded */
  it("never calls a named key gone when the key list could not be read", () => {
    expect(
      describeAudienceSelection(
        { ...EMPTY_AUDIENCE_FORM, admins: true, apiKeyIds: ["key-agent"] },
        { ...OPTIONS, apiKeys: [], apiKeysUnavailable: true },
      ),
    ).toBe("Visible to: Admins, an API key whose name could not be loaded");
  });
});
