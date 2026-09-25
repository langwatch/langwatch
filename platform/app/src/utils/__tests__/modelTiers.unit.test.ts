import { describe, expect, it } from "vitest";

import {
  type ModelVariant,
  rankChatModels,
  TIERED_PROVIDERS,
} from "../modelTiers";

/**
 * OpenAI's named-tier generations as they ship: GPT-5.6 with Sol on top,
 * GPT-6 with Astra on top. Ranked alongside every OpenAI id under test,
 * since a named tier's role is read against its generation's siblings.
 */
const OPENAI_LINEUP = [
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-luna",
  "openai/gpt-6-astra",
  "openai/gpt-6-sol",
  "openai/gpt-6-luna",
];

const withLineup = (ids: string[]) =>
  ids.some((id) => id.startsWith("openai/"))
    ? [...new Set([...ids, ...OPENAI_LINEUP])]
    : ids;

const ranks = ({
  id,
  variant,
  provider = id.split("/")[0]!,
}: {
  id: string;
  variant: ModelVariant;
  provider?: string;
}) =>
  rankChatModels({ ids: withLineup([id]), provider, variant }).some(
    (c) => c.id === id,
  );

/** Sorts exactly the given ids, without the shared lineup. */
const sorted = (ids: string[], variant: ModelVariant) =>
  rankChatModels({ ids, provider: ids[0]!.split("/")[0]!, variant }).map(
    (c) => c.id,
  );

describe("given the OpenAI chat model tier grammar", () => {
  describe("when ranking main-tier candidates", () => {
    it("accepts the unsuffixed id of a generation", () => {
      expect(ranks({ id: "openai/gpt-5.5", variant: "main" })).toBe(true);
    });

    it("accepts the named middle tier of each generation", () => {
      expect(ranks({ id: "openai/gpt-5.6-terra", variant: "main" })).toBe(true);
      expect(ranks({ id: "openai/gpt-6-sol", variant: "main" })).toBe(true);
    });

    it("rejects the top tier of each generation", () => {
      expect(ranks({ id: "openai/gpt-5.6-sol", variant: "main" })).toBe(false);
      expect(ranks({ id: "openai/gpt-6-astra", variant: "main" })).toBe(false);
    });

    /** @scenario A named tier's role follows its generation's lineup */
    it("reads sol as the top tier of GPT-5.6 but the main tier of GPT-6", () => {
      expect(
        sorted(
          [
            "openai/gpt-5.6-sol",
            "openai/gpt-5.6-terra",
            "openai/gpt-6-astra",
            "openai/gpt-6-sol",
          ],
          "main",
        ),
      ).toEqual(["openai/gpt-6-sol", "openai/gpt-5.6-terra"]);
    });

    /** @scenario A generation shipping only its top tier has no main tier yet */
    it("stays on the previous generation while the newest ships only its top tier", () => {
      expect(
        sorted(
          ["openai/gpt-5.6-sol", "openai/gpt-5.6-terra", "openai/gpt-6-astra"],
          "main",
        ),
      ).toEqual(["openai/gpt-5.6-terra"]);
    });

    it("never ranks a tier name it does not know", () => {
      expect(sorted(["openai/gpt-7-nova", "openai/gpt-7-sol"], "main")).toEqual(
        [],
      );
    });

    it("rejects the fast tier", () => {
      expect(ranks({ id: "openai/gpt-5.6-luna", variant: "main" })).toBe(false);
      expect(ranks({ id: "openai/gpt-6-luna", variant: "main" })).toBe(false);
    });

    it.each([
      "openai/gpt-5.6-terra-pro",
      "openai/gpt-6-sol-pro",
      "openai/gpt-6-sol:batch",
      "openai/gpt-5.5-pro",
      "openai/gpt-5.4-nano",
      "openai/gpt-5.3-codex",
      "openai/gpt-5.2-chat",
      "openai/gpt-5.4-image-2",
      "openai/gpt-5.6-terra:batch",
      "openai/gpt-4o-2024-11-20",
    ])("rejects %s", (id) => {
      expect(ranks({ id, variant: "main" })).toBe(false);
    });

    it("rejects ids from other providers", () => {
      expect(
        ranks({ id: "azure/gpt-5.5", provider: "azure", variant: "main" }),
      ).toBe(false);
    });

    it("reads a generation with no minor version as its first release", () => {
      expect(
        rankChatModels({
          ids: ["openai/gpt-6"],
          provider: "openai",
          variant: "main",
        }),
      ).toEqual([{ id: "openai/gpt-6", major: 6, minor: 0, rank: 0 }]);
    });
  });

  describe("when ranking fast candidates", () => {
    it("accepts the legacy -mini suffix", () => {
      expect(ranks({ id: "openai/gpt-5.4-mini", variant: "fast" })).toBe(true);
    });

    it("accepts the named fast tier", () => {
      expect(ranks({ id: "openai/gpt-5.6-luna", variant: "fast" })).toBe(true);
      expect(ranks({ id: "openai/gpt-6-luna", variant: "fast" })).toBe(true);
    });

    it("rejects the main and top tiers", () => {
      expect(ranks({ id: "openai/gpt-5.6-terra", variant: "fast" })).toBe(
        false,
      );
      expect(ranks({ id: "openai/gpt-5.6-sol", variant: "fast" })).toBe(false);
      expect(ranks({ id: "openai/gpt-6-sol", variant: "fast" })).toBe(false);
      expect(ranks({ id: "openai/gpt-6-astra", variant: "fast" })).toBe(false);
    });

    it("rejects the nano tier, which sits below fast", () => {
      expect(ranks({ id: "openai/gpt-5.4-nano", variant: "fast" })).toBe(false);
    });
  });

  describe("when sorting ranked candidates", () => {
    it("puts the newest generation first", () => {
      expect(
        sorted(
          [
            "openai/gpt-5.4",
            "openai/gpt-5.6-sol",
            "openai/gpt-5.6-terra",
            "openai/gpt-5.5",
          ],
          "main",
        ),
      ).toEqual(["openai/gpt-5.6-terra", "openai/gpt-5.5", "openai/gpt-5.4"]);
    });

    it("compares minor versions numerically, not as text", () => {
      // A lexical sort would rank "5.9" above "5.10".
      expect(sorted(["openai/gpt-5.9", "openai/gpt-5.10"], "main")[0]).toBe(
        "openai/gpt-5.10",
      );
    });

    /** @scenario A generation shipping both an unsuffixed model and a named main tier */
    it("breaks a same-generation tie in favour of the named tier", () => {
      expect(
        sorted(
          ["openai/gpt-5.7", "openai/gpt-5.7-sol", "openai/gpt-5.7-terra"],
          "main",
        )[0],
      ).toBe("openai/gpt-5.7-terra");
    });
  });
});

describe("given the Anthropic chat model tier grammar", () => {
  it("ranks Opus as the main tier and Sonnet as the fast tier", () => {
    expect(ranks({ id: "anthropic/claude-opus-4-8", variant: "main" })).toBe(
      true,
    );
    expect(ranks({ id: "anthropic/claude-sonnet-4-6", variant: "fast" })).toBe(
      true,
    );
    expect(ranks({ id: "anthropic/claude-sonnet-4-6", variant: "main" })).toBe(
      false,
    );
  });

  /** @scenario Fable and Haiku are never alias targets */
  it.each([
    ["anthropic/claude-fable-5-1", "main"],
    ["anthropic/claude-fable-5-1", "fast"],
    ["anthropic/claude-haiku-4-5", "fast"],
    ["anthropic/claude-opus-5:batch", "main"],
    ["anthropic/claude-3-haiku", "fast"],
  ] as const)("rejects %s as %s", (id, variant) => {
    expect(ranks({ id, variant })).toBe(false);
  });

  /** @scenario A generation without a minor version outranks the previous generation */
  it("reads claude-opus-5 as generation 5 and puts it above every 4-x", () => {
    expect(
      sorted(["anthropic/claude-opus-4-8", "anthropic/claude-opus-5"], "main"),
    ).toEqual(["anthropic/claude-opus-5", "anthropic/claude-opus-4-8"]);
  });
});

describe("given the Gemini chat model tier grammar", () => {
  it("ranks Flash as the main tier and Flash Lite as the fast tier", () => {
    expect(ranks({ id: "gemini/gemini-3.8-flash", variant: "main" })).toBe(
      true,
    );
    expect(ranks({ id: "gemini/gemini-3.5-flash-lite", variant: "fast" })).toBe(
      true,
    );
    expect(ranks({ id: "gemini/gemini-3.5-flash-lite", variant: "main" })).toBe(
      false,
    );
  });

  /** @scenario Gemini Pro and the image variants are never alias targets */
  it.each([
    ["gemini/gemini-3.1-pro-preview", "main"],
    ["gemini/gemini-2.5-pro", "main"],
    ["gemini/gemini-3.1-flash-image", "main"],
    ["gemini/gemini-3.1-flash-lite-image", "fast"],
    ["gemini/gemini-3.1-pro-preview-customtools", "main"],
    ["gemini/gemini-3.8-flash:batch", "main"],
    ["gemini/gemma-4-31b-it", "main"],
  ] as const)("rejects %s as %s", (id, variant) => {
    expect(ranks({ id, variant })).toBe(false);
  });

  it("puts a generation's release above its preview", () => {
    expect(
      sorted(
        ["gemini/gemini-3-flash-preview", "gemini/gemini-3-flash"],
        "main",
      ),
    ).toEqual(["gemini/gemini-3-flash", "gemini/gemini-3-flash-preview"]);
  });
});

describe("given the DeepSeek chat model tier grammar", () => {
  it("ranks V4 Pro as the main tier and V4 Flash as the fast tier", () => {
    expect(ranks({ id: "deepseek/deepseek-v4-pro", variant: "main" })).toBe(
      true,
    );
    expect(ranks({ id: "deepseek/deepseek-v4-flash", variant: "fast" })).toBe(
      true,
    );
  });

  it("ranks an unsuffixed V3 release as the main tier of its generation", () => {
    expect(
      sorted(["deepseek/deepseek-v3.2", "deepseek/deepseek-v4-pro"], "main"),
    ).toEqual(["deepseek/deepseek-v4-pro", "deepseek/deepseek-v3.2"]);
  });

  /** @scenario Dated, experimental and vision variants never win */
  it.each([
    ["deepseek/deepseek-v4-pro-0813", "main"],
    ["deepseek/deepseek-v4-pro-0813:batch", "main"],
    ["deepseek/deepseek-v3.2-exp", "main"],
    ["deepseek/deepseek-v4-flash-vision-exp", "fast"],
    ["deepseek/deepseek-v3.1-terminus", "main"],
    ["deepseek/deepseek-r1", "main"],
    ["deepseek/deepseek-chat", "main"],
  ] as const)("rejects %s as %s", (id, variant) => {
    expect(ranks({ id, variant })).toBe(false);
  });
});

describe("given a provider without a tier grammar", () => {
  it("ranks nothing", () => {
    expect(ranks({ id: "xai/grok-4.6", variant: "main" })).toBe(false);
    expect(TIERED_PROVIDERS).toEqual([
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
    ]);
  });
});
