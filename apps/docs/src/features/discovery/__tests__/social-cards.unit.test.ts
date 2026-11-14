import { describe, expect, it } from "vitest";

import { pageHead } from "../compile/page-head.ts";
import {
  DEFAULT_SOCIAL_CARD,
  SOCIAL_CARDS,
  socialCardFor,
  socialCardPath,
  type SocialCard,
} from "../compile/social-cards.ts";

const SETTINGS = { description: "", organization: null, tagManager: "", dates: new Map() };

describe("when a page is shared", () => {
  const tracing: SocialCard = {
    id: "tracing",
    prefix: "tracing",
    eyebrow: "Tracing",
    title: "Trace it",
    line: "Every call.",
  };
  const spans: SocialCard = { ...tracing, id: "spans", prefix: "tracing/spans" };

  /** @scenario "A shared link shows the card of the section it points into" */
  it("uses the card of the longest prefix that owns the page, else the default", () => {
    const cards = [tracing, spans];
    expect(socialCardFor({ slug: "tracing/setup", cards })).toBe(tracing);
    expect(socialCardFor({ slug: "tracing", cards })).toBe(tracing);
    expect(socialCardFor({ slug: "tracing/spans/attributes", cards })).toBe(spans);
    expect(socialCardFor({ slug: "tracingx/setup", cards })).toBe(DEFAULT_SOCIAL_CARD);
    expect(socialCardFor({ slug: "introduction", cards })).toBe(DEFAULT_SOCIAL_CARD);
  });

  /** @scenario "A shared link shows the card of the section it points into" */
  it("names the section's card in the head, with its size and alternative text", () => {
    const head = pageHead({
      slug: "evaluations/overview",
      title: "Evaluations",
      settings: SETTINGS,
    });
    const card = SOCIAL_CARDS.find(({ id }) => id === "evaluations");
    if (!card) throw new Error("the evaluations card is listed");
    const image = `https://langwatch.ai/docs${socialCardPath({ card })}`;
    expect(head).toContain(`<meta property="og:image" content="${image}">`);
    expect(head).toContain(`<meta name="twitter:image" content="${image}">`);
    expect(head).toContain('<meta property="og:image:width" content="1200">');
    expect(head).toContain('<meta property="og:image:height" content="630">');
    expect(head).toContain(
      `<meta property="og:image:alt" content="LangWatch evaluations: ${card.title}">`,
    );
  });

  /** @scenario "A shared link shows the card of the section it points into" */
  it("shows the default card on the docs home and on unlisted sections", () => {
    const fallback = `https://langwatch.ai/docs${socialCardPath({ card: DEFAULT_SOCIAL_CARD })}`;
    for (const slug of ["introduction", "cookbooks/finetuning-agents"]) {
      const head = pageHead({ slug, title: "Page", settings: SETTINGS });
      expect(head).toContain(`<meta property="og:image" content="${fallback}">`);
    }
  });

  /** @scenario "A shared link shows the card of the section it points into" */
  it("publishes each card under a hashed name that changes with its text", () => {
    expect(socialCardPath({ card: tracing })).toMatch(/^\/social\/tracing\.[0-9a-f]{12}\.webp$/);
    expect(socialCardPath({ card: { ...tracing, line: "Every LLM call." } })).not.toBe(
      socialCardPath({ card: tracing }),
    );
  });

  /** @scenario "A shared link shows the card of the section it points into" */
  it("keeps card ids and prefixes unique, so each card has one file and one owner", () => {
    const ids = [DEFAULT_SOCIAL_CARD, ...SOCIAL_CARDS].map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const prefixes = SOCIAL_CARDS.map(({ prefix }) => prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
