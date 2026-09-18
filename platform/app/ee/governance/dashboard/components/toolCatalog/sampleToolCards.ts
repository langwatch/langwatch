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
 * The eight tools the sample catalog shows, with every row filled in.
 *
 * This is the screen an organization gets once the measurements behind the
 * rows exist, and it is what makes the empty rows on a real card readable as a
 * roadmap rather than as damage. Every figure here is invented, which is why
 * they live in their own list under their own badge and never merge with a
 * real card. The two consumption-billed tools carry a seat sentence rather
 * than a count, because "0 of 0" would read as a tool nobody uses.
 */
export const SAMPLE_TOOL_CARDS: ToolCard[] = [
  {
    id: "sample-claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    sourceType: "claude_code",
    badges: ["seatsAndLicences", "metered"],
    values: {
      seats: "44 of 60 assigned",
      eventsLast24Hours: 8412,
      usage30Days: "$3,268",
      attributed: "91%",
      topDepartment: "Engineering",
      agents: 12,
      tokens30Days: 412900000,
      conversations30Days: 6140,
    },
    isSample: true,
  },
  {
    id: "sample-claude-cowork",
    name: "Claude Cowork",
    vendor: "Anthropic",
    sourceType: "claude_cowork",
    badges: ["seatsAndLicences", "metered"],
    values: {
      seats: "28 of 40 assigned",
      eventsLast24Hours: 1904,
      usage30Days: "$820",
      attributed: "78%",
      topDepartment: "Operations",
      agents: 4,
      tokens30Days: 58300000,
      conversations30Days: 2210,
    },
    isSample: true,
  },
  {
    id: "sample-copilot-studio",
    name: "Copilot Studio",
    vendor: "Microsoft",
    sourceType: "copilot_studio_dataverse",
    badges: ["seatsAndLicences", "billed"],
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
    values: {
      seats: "310 of 340 assigned",
      eventsLast24Hours: 22180,
      usage30Days: "$6,460",
      attributed: "96%",
      topDepartment: "Engineering",
      agents: 1,
      tokens30Days: 163500000,
      conversations30Days: 41900,
    },
    isSample: true,
  },
  {
    id: "sample-chatgpt-enterprise",
    name: "ChatGPT Enterprise",
    vendor: "OpenAI",
    sourceType: "openai_compliance",
    badges: ["seatsAndLicences", "billed"],
    values: {
      seats: "180 of 250 assigned",
      eventsLast24Hours: 14060,
      usage30Days: "$15,000",
      attributed: "88%",
      topDepartment: "Marketing",
      agents: 9,
      tokens30Days: 204100000,
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
    values: {
      seats: "62 of 75 assigned",
      eventsLast24Hours: 9730,
      usage30Days: "$1,500",
      attributed: "72%",
      topDepartment: "Engineering",
      agents: 3,
      tokens30Days: 88700000,
      conversations30Days: 4980,
    },
    isSample: true,
  },
  {
    id: "sample-databricks-genie",
    name: "Databricks Genie",
    vendor: "Databricks",
    sourceType: "databricks_genie",
    badges: ["billed"],
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
    values: {
      seats: "no seats, billed on consumption",
      eventsLast24Hours: 3120,
      usage30Days: "$740",
      attributed: "58%",
      topDepartment: "Engineering",
      agents: 18,
      tokens30Days: 31200000,
      conversations30Days: 2050,
    },
    isSample: true,
  },
];
