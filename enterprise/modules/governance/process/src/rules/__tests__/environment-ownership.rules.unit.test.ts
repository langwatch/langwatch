// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One connection per conversation environment, refused at save time.
 *
 * The sibling of the Azure bill guard, for the identity an admin types rather
 * than one the provider reports. Two connections onto one Power Platform
 * environment read the same conversations twice and file them under two source
 * identities, which is the same double count the bill guard exists to stop.
 *
 * The comparison is the reason this is a guard and not an equality check: an
 * environment address survives a trailing slash, a change of case and a path
 * after it, and a check that takes the typed text at face value refuses almost
 * nothing. `isSameDataverseEnvironment` already normalises exactly that, so it
 * is imported rather than re-derived here.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Decision: 00d claim C, settlement 6 (Dataverse identity = environment origin).
 */

import { describe, expect, it } from "vitest";

// The environment arm of the one-connection-per-account rule. Lives beside
// `azure-bill-ownership.rules.ts` rather than inside it, because an environment is not
// an Azure bill and the module is named after what it owns.
import {
  findEnvironmentClaimComplaints,
  type EnvironmentReader,
} from "../environment-ownership.rules.ts";

const ENVIRONMENT = "https://orgtest01.crm4.dynamics.com";

const existingReader = (overrides: Partial<EnvironmentReader> = {}): EnvironmentReader => ({
  id: "src_first",
  name: "Copilot Studio, first",
  environmentUrl: ENVIRONMENT,
  ...overrides,
});

const configNaming = (environmentUrl: string) => ({
  adapter: "copilot_studio_dataverse",
  environmentUrl,
});

describe("given a connection already reading a conversation environment", () => {
  describe("when the admin saves another connection naming that same environment written differently", () => {
    /** @scenario "A second connection to an environment another connection reads is refused" */
    it.each([
      ["a trailing slash", `${ENVIRONMENT}/`],
      ["capital letters in the host", "https://ORGTEST01.CRM4.DYNAMICS.COM"],
      ["a path after it", `${ENVIRONMENT}/api/data/v9.2/`],
      ["surrounding space", `  ${ENVIRONMENT}  `],
    ])("refuses the save when the second names it with %s", (_case, typed) => {
      expect(
        findEnvironmentClaimComplaints({
          parserConfig: configNaming(typed),
          claimedBy: [existingReader()],
        }),
      ).toHaveLength(1);
    });

    /** @scenario "A second connection to an environment another connection reads is refused" */
    it("names the connection that already reads it, where the screen reads it", () => {
      // The sentence has to travel in `meta.formErrors`: without it the admin
      // gets the generic "Check your input" copy and never learns which
      // connection already holds the environment, which is the whole point of
      // naming the owner.
      expect(
        findEnvironmentClaimComplaints({
          parserConfig: configNaming(`${ENVIRONMENT}/`),
          claimedBy: [existingReader({ name: "Copilot Studio, first" })],
        }),
      ).toEqual([expect.stringMatching(/Copilot Studio, first/)]);
    });
  });

  describe("when the admin saves that same connection again", () => {
    it("saves it, rather than colliding the connection with itself", () => {
      expect(
        findEnvironmentClaimComplaints({
          parserConfig: configNaming(ENVIRONMENT),
          claimedBy: [existingReader({ id: "src_first" })],
          sourceId: "src_first",
        }),
      ).toEqual([]);
    });
  });

  describe("when the admin saves a connection naming a different environment", () => {
    it("saves it — a different environment is different conversations", () => {
      expect(
        findEnvironmentClaimComplaints({
          parserConfig: configNaming("https://orgtest02.crm4.dynamics.com"),
          claimedBy: [existingReader()],
        }),
      ).toEqual([]);
    });
  });
});

describe("given a config that names no environment at all", () => {
  describe("when it is checked", () => {
    it.each([
      ["the field is absent", undefined],
      ["the field is empty", ""],
      ["the field is only space", "   "],
      ["the field is not a string", 12345],
    ])("saves it when %s", (_case, environmentUrl) => {
      const parserConfig: Record<string, unknown> = {
        adapter: "copilot_studio_dataverse",
      };
      if (environmentUrl !== undefined) {
        parserConfig.environmentUrl = environmentUrl;
      }
      expect(
        findEnvironmentClaimComplaints({
          parserConfig,
          // A reader whose own address is blank must not swallow a blank
          // claim: two connections that name nothing are not in conflict.
          claimedBy: [existingReader({ environmentUrl: "" })],
        }),
      ).toEqual([]);
    });
  });
});
