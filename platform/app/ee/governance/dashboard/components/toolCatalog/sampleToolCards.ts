// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ToolCard } from "./toolCards";

/**
 * The invented catalog, kept away from the real one.
 *
 * It lives in its own module for the same reason it is a separate list rather
 * than a flag: the one rule `toolCards.ts` is built around is that a figure is
 * either measured or absent, and eight cards of invented figures sitting in
 * that file is an invitation to reach for one. Nothing here is read from
 * anything. Every card carries `isSample: true` and is badged wherever it
 * renders.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */

/**
 * The eight tools the sample catalog shows, with every applicable row filled.
 *
 * This is the screen an organization gets once the measurements behind the
 * rows exist, and it is what makes the empty rows on a real card readable as a
 * roadmap rather than as damage. Every figure here is invented, which is why
 * they live in their own list under their own badge and never merge with a
 * real card.
 *
 * EACH CARD DECLARES ITS OWN ROWS, hand-authored rather than derived, and the
 * eight of them are chosen to show four different shapes: a per-person
 * subscription with no seat list to read, a seat-licensed product with
 * unassigned seats to find, a seat-licensed agent platform that also meters
 * conversation credits, and a consumption-billed tool where the token count is
 * the billed unit. A reader who has seen all four can tell at a glance why one
 * of their real cards is shorter than another.
 *
 * The two consumption-billed tools keep a seats row carrying a sentence rather
 * than a count. That is the exception and it is deliberate: "billed on
 * consumption" is the answer to the question a buyer arrives with, and leaving
 * the row out entirely would let the reader assume nobody had looked.
 */
export const SAMPLE_TOOL_CARDS: ToolCard[] = [
  {
    id: "sample-claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    sourceType: "claude_code",
    badges: ["subscription"],
    // Paid for per person, on each person's own plan. There is no seat list
    // an administrator assigns from, so no seat can go unassigned and no
    // licence line exists to price — the count that matters is how many plans
    // are in use. Tokens are left out because the plan, not the traffic, is
    // what is billed: the token count would be the Usage figure told twice.
    applicableRows: [
      "subscriptions",
      "eventsLast24Hours",
      "usage30Days",
      "attributed",
      "topDepartment",
    ],
    values: {
      subscriptions: 44,
      eventsLast24Hours: 8412,
      usage30Days: "$3,268",
      attributed: "91%",
      topDepartment: "Engineering",
    },
    isSample: true,
  },
  {
    id: "sample-claude-cowork",
    name: "Claude Cowork",
    vendor: "Anthropic",
    sourceType: "claude_cowork",
    badges: ["subscription"],
    applicableRows: [
      "subscriptions",
      "eventsLast24Hours",
      "usage30Days",
      "attributed",
      "topDepartment",
    ],
    values: {
      subscriptions: 28,
      eventsLast24Hours: 1904,
      usage30Days: "$820",
      attributed: "78%",
      topDepartment: "Operations",
    },
    isSample: true,
  },
  {
    id: "sample-copilot-studio",
    name: "Copilot Studio",
    vendor: "Microsoft",
    sourceType: "copilot_studio_dataverse",
    badges: ["seatsAndLicences", "billed"],
    // Both at once, which is why the badges are two facts rather than one
    // word: seats are bought per person AND conversation credits are metered
    // on top, so the token count is a figure of its own beside the licence.
    // It also hosts agents and carries a conversation stream.
    applicableRows: [
      "seats",
      "licencePerMonth",
      "idlePerMonth",
      "eventsLast24Hours",
      "usage30Days",
      "attributed",
      "topDepartment",
      "agents",
      "tokens30Days",
      "conversations30Days",
    ],
    values: {
      seats: "120 of 200 assigned",
      eventsLast24Hours: 5310,
      attributed: "84%",
      topDepartment: "Customer Support",
      agents: 31,
      conversations30Days: 18720,
    },
    isSample: true,
  },
  {
    id: "sample-github-copilot",
    name: "GitHub Copilot",
    vendor: "GitHub",
    sourceType: null,
    badges: ["seatsAndLicences", "billed"],
    // Seat-licensed: an administrator assigns seats, so unassigned seats are
    // money already spent and are the row a renewal is read for.
    applicableRows: [
      "seats",
      "licencePerMonth",
      "idlePerMonth",
      "eventsLast24Hours",
      "usage30Days",
      "attributed",
      "topDepartment",
    ],
    values: {
      seats: "310 of 340 assigned",
      eventsLast24Hours: 22180,
      usage30Days: "$6,460",
      attributed: "96%",
      topDepartment: "Engineering",
    },
    isSample: true,
  },
  {
    id: "sample-chatgpt-enterprise",
    name: "ChatGPT Enterprise",
    vendor: "OpenAI",
    sourceType: "openai_compliance",
    badges: ["seatsAndLicences", "billed"],
    // Seat-licensed, and a conversation product: the compliance source
    // delivers the conversations, so that count is real. Agents are not a
    // thing it has.
    applicableRows: [
      "seats",
      "licencePerMonth",
      "idlePerMonth",
      "eventsLast24Hours",
      "usage30Days",
      "attributed",
      "topDepartment",
      "conversations30Days",
    ],
    values: {
      seats: "180 of 250 assigned",
      eventsLast24Hours: 14060,
      usage30Days: "$15,000",
      attributed: "88%",
      topDepartment: "Marketing",
      conversations30Days: 31450,
    },
    isSample: true,
  },
  {
    id: "sample-cursor",
    name: "Cursor",
    vendor: "Anysphere",
    sourceType: null,
    badges: ["seatsAndLicences", "billed"],
    applicableRows: [
      "seats",
      "licencePerMonth",
      "idlePerMonth",
      "eventsLast24Hours",
      "usage30Days",
      "attributed",
      "topDepartment",
    ],
    values: {
      seats: "62 of 75 assigned",
      eventsLast24Hours: 9730,
      usage30Days: "$1,500",
      attributed: "72%",
      topDepartment: "Engineering",
    },
    isSample: true,
  },
  {
    id: "sample-databricks-genie",
    name: "Databricks Genie",
    vendor: "Databricks",
    sourceType: "databricks_genie",
    badges: ["metered"],
    // Billed on what it ran, so there is no licence to price and no seat to
    // leave unassigned. The seats row stays only to say so.
    applicableRows: [
      "seats",
      "eventsLast24Hours",
      "usage30Days",
      "attributed",
      "topDepartment",
      "agents",
      "tokens30Days",
      "conversations30Days",
    ],
    values: {
      seats: "no seats, billed on consumption",
      eventsLast24Hours: 640,
      usage30Days: "$2,980",
      attributed: "69%",
      topDepartment: "Data",
      agents: 7,
      conversations30Days: 1340,
    },
    isSample: true,
  },
  {
    id: "sample-custom-agents",
    name: "Custom Agents",
    vendor: "In-house",
    sourceType: "http_custom",
    badges: ["metered"],
    // Built in-house and metered through the gateway, so tokens are the unit
    // the bill is computed from and stand beside the dollar figure rather
    // than repeating it.
    applicableRows: [
      "seats",
      "eventsLast24Hours",
      "usage30Days",
      "attributed",
      "topDepartment",
      "agents",
      "tokens30Days",
      "conversations30Days",
    ],
    values: {
      seats: "no seats, billed on consumption",
      eventsLast24Hours: 3120,
      usage30Days: "$1,240",
      attributed: "58%",
      topDepartment: "Engineering",
      agents: 18,
      tokens30Days: 412900000,
      conversations30Days: 2050,
    },
    isSample: true,
  },
];
