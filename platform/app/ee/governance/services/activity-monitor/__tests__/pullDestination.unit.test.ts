import { describe, expect, it } from "vitest";
import { DATABRICKS_GENIE_ADAPTER_ID } from "../../pullers/databricksGenie.puller";
import { assertPullDestinationAllowed } from "../pullDestination";

const genie = (workspaceUrl: string) => ({
  adapter: DATABRICKS_GENIE_ADAPTER_ID,
  workspaceUrl,
  credentials: { token: "dapi-secret" },
});

describe("given a Genie config naming a real workspace", () => {
  describe("when the destination is checked", () => {
    it.each([
      "https://adb-7405615080492024.4.azuredatabricks.net",
      "https://dbc-1234abcd-5e6f.cloud.databricks.com",
      "https://1234567890.7.gcp.databricks.com",
    ])("accepts %s", (url) => {
      expect(() => assertPullDestinationAllowed(genie(url))).not.toThrow();
    });
  });
});

describe("given a Genie config pointed somewhere the token must never go", () => {
  describe("when the destination is checked", () => {
    /** @scenario "The token may only be sent to a Databricks workspace" */
    it("refuses a host the attacker controls", () => {
      expect(() =>
        assertPullDestinationAllowed(genie("https://attacker.example.com")),
      ).toThrow(/Databricks workspace address/);
    });

    /**
     * The admin has to be able to act on the rejection, and the only thing that
     * tells them what to type instead is the message itself. Asserting the
     * phrasing alone would let it shrink to "invalid workspace URL" and still
     * pass, which is a rejection with nowhere to go.
     *
     * @scenario "The token may only be sent to a Databricks workspace"
     */
    it("names every address that would have been accepted", () => {
      let message = "";
      try {
        assertPullDestinationAllowed(genie("https://attacker.example.com"));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain(".azuredatabricks.net");
      expect(message).toContain(".cloud.databricks.com");
      expect(message).toContain(".gcp.databricks.com");
    });

    it("refuses a lookalike that merely contains the real domain", () => {
      expect(() =>
        assertPullDestinationAllowed(
          genie("https://azuredatabricks.net.attacker.example.com"),
        ),
      ).toThrow(/Databricks workspace address/);
    });

    it("refuses plain http, which would expose the token even to a real workspace", () => {
      expect(() =>
        assertPullDestinationAllowed(
          genie("http://adb-1234567890123456.7.azuredatabricks.net"),
        ),
      ).toThrow(/Databricks workspace address/);
    });

    it("refuses a URL smuggling credentials in its userinfo", () => {
      expect(() =>
        assertPullDestinationAllowed(
          genie("https://user:pass@adb-1.7.azuredatabricks.net"),
        ),
      ).toThrow(/Databricks workspace address/);
    });

    it("refuses a missing workspace URL rather than letting it through", () => {
      expect(() =>
        assertPullDestinationAllowed({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
        }),
      ).toThrow(/Databricks workspace address/);
    });
  });
});

describe("given a config for an adapter with no fixed destination", () => {
  describe("when the destination is checked", () => {
    it("leaves it alone rather than inventing a rule for it", () => {
      expect(() =>
        assertPullDestinationAllowed({
          adapter: "http_polling",
          url: "https://customers-own-audit-api.example.com/events",
        }),
      ).not.toThrow();
    });

    it("ignores a config with no adapter at all", () => {
      expect(() =>
        assertPullDestinationAllowed({ ottlStatements: [] }),
      ).not.toThrow();
      expect(() => assertPullDestinationAllowed(null)).not.toThrow();
    });
  });
});
