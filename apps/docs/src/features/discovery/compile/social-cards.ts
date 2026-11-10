/* The image a shared link shows: one card per popular destination, the default card for the rest.
   To add a card, add an entry to SOCIAL_CARDS; the build renders it and every page under its
   prefix names it. A card's file name hashes its text and template, so hosts cache it forever. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { docsRoot } from "../../../paths.ts";

export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;

export type SocialCard = {
  /** Names the published file: `social/<id>.<hash>.png`. */
  id: string;
  /** Pages whose slug is this or starts with it and a slash use the card; the longest wins. */
  prefix: string;
  eyebrow: string;
  title: string;
  line: string;
};

export const DEFAULT_SOCIAL_CARD: SocialCard = {
  id: "docs",
  prefix: "",
  eyebrow: "Documentation",
  title: "The open-source platform for AI in production",
  line: "Trace, test, route and govern every LLM call, from your own agents to coding assistants.",
};

export const SOCIAL_CARDS: readonly SocialCard[] = [
  {
    id: "integration",
    prefix: "integration",
    eyebrow: "Integrations",
    title: "Connect LangWatch to your stack",
    line: "SDKs and OpenTelemetry for every major LLM provider, framework and tool.",
  },
  {
    id: "observability",
    prefix: "observability",
    eyebrow: "Observability",
    title: "Trace every LLM call",
    line: "Monitor, debug and analyse your LLM applications in production.",
  },
  {
    id: "agent-testing",
    prefix: "agent-testing",
    eyebrow: "Agent testing",
    title: "Test agents with simulated users",
    line: "Multi-turn scenarios that catch issues before production and prevent regressions.",
  },
  {
    id: "evaluations",
    prefix: "evaluations",
    eyebrow: "Evaluations",
    title: "Score agents before and after you ship",
    line: "Experiments on datasets, online evaluations on live traffic, and guardrails.",
  },
  {
    id: "prompt-management",
    prefix: "prompt-management",
    eyebrow: "Prompt management",
    title: "Version, tag and ship prompts",
    line: "Prompts linked to the traces they produced, fetched by your app at runtime.",
  },
  {
    id: "datasets",
    prefix: "datasets",
    eyebrow: "Datasets",
    title: "Datasets from files or your traces",
    line: "Build them by hand, from CSV or JSON, or from production, and run experiments on them.",
  },
  {
    id: "ai-gateway",
    prefix: "ai-gateway",
    eyebrow: "AI Gateway",
    title: "One endpoint for every LLM call",
    line: "OpenAI- and Anthropic-compatible, with virtual keys, budgets and a trace per request.",
  },
  {
    id: "ai-governance",
    prefix: "ai-governance",
    eyebrow: "AI Governance",
    title: "Every AI tool in the company, in one place",
    line: "The tools, the people who use them and the agents they run.",
  },
  {
    id: "coding-agents",
    prefix: "coding-agents",
    eyebrow: "Coding agents",
    title: "What your coding agents do and cost",
    line: "Claude Code, Codex, Copilot and more, per session, per pull request and per team.",
  },
  {
    id: "improve-your-agent",
    prefix: "improve-your-agent",
    eyebrow: "Improve your agent",
    title: "Faster and cheaper, never worse",
    line: "A scenario test suite as the quality gate, one hypothesis at a time.",
  },
  {
    id: "self-hosting",
    prefix: "self-hosting",
    eyebrow: "Self-hosting",
    title: "Run LangWatch on your own infrastructure",
    line: "Deploy the platform where your data already lives.",
  },
  {
    id: "api-reference",
    prefix: "api-reference",
    eyebrow: "API reference",
    title: "The LangWatch REST API",
    line: "Authentication, the OpenAPI document and every operation.",
  },
];

/** The card a page shares: the longest prefix that owns its slug, else the default. */
export function socialCardFor({
  slug,
  cards = SOCIAL_CARDS,
}: {
  slug: string;
  cards?: readonly SocialCard[];
}) {
  let best = DEFAULT_SOCIAL_CARD;
  for (const card of cards) {
    const owns = slug === card.prefix || slug.startsWith(`${card.prefix}/`);
    if (owns && card.prefix.length > best.prefix.length) best = card;
  }
  return best;
}

/** Text a screen reader announces for the card. */
export function socialCardAlt({ card }: { card: SocialCard }) {
  return `LangWatch ${card.eyebrow.toLowerCase()}: ${card.title}`;
}

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

let logo: string | undefined;

/** The card as a page: fonts load from `/fonts/<file>`, which the renderer serves. */
export function socialCardHtml({ card }: { card: SocialCard }) {
  logo ??= readFileSync(path.join(docsRoot, "logo/dark.svg"), "utf8");
  const { width, height } = SOCIAL_CARD_SIZE;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(/fonts/Inter-Variable-latin.woff2);font-weight:100 900}
@font-face{font-family:Sentient;src:url(/fonts/Sentient-Medium.woff2);font-weight:500}
*{margin:0;box-sizing:border-box}
body{width:${width}px;height:${height}px;padding:72px 80px;display:flex;flex-direction:column;
background:#fffaf3 linear-gradient(135deg,#fff 0%,#fff4e5 100%);color:#1c1917;font-family:Inter}
.logo svg{height:48px;width:auto}
.eyebrow{margin-top:auto;color:#e17100;font-size:30px;font-weight:600;letter-spacing:.02em}
h1{margin-top:18px;font-family:Sentient;font-weight:500;font-size:68px;line-height:1.08;
letter-spacing:-.01em;max-width:1000px}
p{margin-top:24px;font-size:30px;line-height:1.35;color:#57534e;max-width:960px}
.bar{position:absolute;left:0;right:0;bottom:0;height:12px;background:linear-gradient(90deg,#e17100,#fe9a00)}
</style></head><body><div class="logo">${logo}</div>
<div class="eyebrow">${escapeHtml(card.eyebrow)}</div>
<h1>${escapeHtml(card.title)}</h1><p>${escapeHtml(card.line)}</p><div class="bar"></div></body></html>`;
}

/** Where the card is published; its hash covers the template, so a change gets a new name. */
export function socialCardPath({ card }: { card: SocialCard }) {
  const hash = createHash("sha256").update(socialCardHtml({ card })).digest("hex").slice(0, 12);
  return `/social/${card.id}.${hash}.png`;
}

/** Every card the build publishes: the listed ones and the default. */
export function allSocialCards() {
  return [DEFAULT_SOCIAL_CARD, ...SOCIAL_CARDS];
}
