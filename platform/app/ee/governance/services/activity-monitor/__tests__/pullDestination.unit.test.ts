import { describe, expect, it } from "vitest";
import { DATABRICKS_GENIE_ADAPTER_ID } from "../../pullers/databricksGenie.puller";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../../pullers/dataverseEnvironment";
import { assertPullDestinationAllowed } from "../pullDestination";

const dataverse = (environmentUrl: string) => ({
  adapter: COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
  environmentUrl,
  credentials: { clientId: "app-id", clientSecret: "app-secret" },
});

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

describe("given a Copilot config naming a real Power Platform environment", () => {
  describe("when the destination is checked", () => {
    /** @scenario "An environment address Microsoft does not host is refused at save time" */
    it.each([
      "https://org12345.crm.dynamics.com",
      "https://org12345.crm4.dynamics.com",
      // The numbered label is not a fixed list — Microsoft keeps adding
      // numbers, and a check written against today's set would start
      // rejecting real environments without anyone changing it.
      "https://org12345.crm17.dynamics.com",
      "https://org12345.crm9.dynamics.com", // US government community cloud
      "https://org12345.crm.microsoftdynamics.us", // GCC High
      "https://org12345.crm.appsplatform.us", // Department of Defense
      "https://org12345.crm.dynamics.cn", // China, operated by 21Vianet
    ])("accepts %s", (url) => {
      expect(() => assertPullDestinationAllowed(dataverse(url))).not.toThrow();
    });
  });
});

describe("given a Copilot config pointed somewhere the secret must never go", () => {
  describe("when the destination is checked", () => {
    /** @scenario "An environment address Microsoft does not host is refused at save time" */
    it("refuses a host the attacker controls", () => {
      expect(() =>
        assertPullDestinationAllowed(dataverse("https://attacker.example.com")),
      ).toThrow(/Power Platform environment address/);
    });

    /**
     * A suffix check written without the leading dot would accept this, and
     * the domain is registrable by anyone.
     *
     * @scenario "An environment address Microsoft does not host is refused at save time"
     */
    it("refuses a lookalike domain that merely ends in the same letters", () => {
      expect(() =>
        assertPullDestinationAllowed(dataverse("https://evildynamics.com")),
      ).toThrow(/Power Platform environment address/);
    });

    /** @scenario "An environment address that is not secure is refused at save time" */
    it("refuses plain http even to a real environment", () => {
      expect(() =>
        assertPullDestinationAllowed(
          dataverse("http://org12345.crm.dynamics.com"),
        ),
      ).toThrow(/Power Platform environment address/);
    });

    it("refuses credentials embedded in the address", () => {
      expect(() =>
        assertPullDestinationAllowed(
          dataverse("https://user:pass@org12345.crm.dynamics.com"),
        ),
      ).toThrow(/Power Platform environment address/);
    });

    it("refuses a missing environment URL rather than letting it through", () => {
      expect(() =>
        assertPullDestinationAllowed({
          adapter: COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
        }),
      ).toThrow(/Power Platform environment address/);
    });

    /**
     * The admin has to be able to act on the rejection. A customer on their
     * own domain is a real case this check cannot serve, and the message is
     * the only place they learn that a ticket is the way forward rather than
     * a different spelling of the address.
     *
     * @scenario "An environment address Microsoft does not host is refused at save time"
     */
    it("names every address that would have been accepted, and the way out", () => {
      let message = "";
      try {
        assertPullDestinationAllowed(dataverse("https://attacker.example.com"));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain(".dynamics.com");
      expect(message).toContain(".microsoftdynamics.us");
      expect(message).toContain(".appsplatform.us");
      expect(message).toContain(".dynamics.cn");
      expect(message).toContain("support");
    });
  });
});

describe("given a config whose adapter is known only to the caller", () => {
  /**
   * The update path cannot read the adapter from the config it is checking.
   * The edit form sends back only the fields it renders, and `adapter` is
   * deliberately not one of them — so dispatching on the incoming value makes
   * the check do nothing on precisely the request that repoints the host.
   * The caller passes the adapter from the stored row instead.
   *
   * @scenario "An environment address Microsoft does not host is refused at save time"
   */
  it("checks the destination using the adapter the caller supplies", () => {
    const withoutAdapter = {
      environmentUrl: "https://attacker.example.com",
      credentials: { clientSecret: "app-secret" },
    };
    // Without the caller's adapter there is nothing to dispatch on, which is
    // the hole: the same config sails through.
    expect(() => assertPullDestinationAllowed(withoutAdapter)).not.toThrow();
    expect(() =>
      assertPullDestinationAllowed(
        withoutAdapter,
        COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
      ),
    ).toThrow(/Power Platform environment address/);
  });

  it("does the same for a workspace being repointed", () => {
    expect(() =>
      assertPullDestinationAllowed(
        { workspaceUrl: "https://attacker.example.com" },
        DATABRICKS_GENIE_ADAPTER_ID,
      ),
    ).toThrow(/Databricks workspace address/);
  });

  it("prefers the caller's adapter over one carried in the config", () => {
    // A request that names a harmless adapter alongside a repointed host must
    // not talk the check out of the stored adapter's rule.
    expect(() =>
      assertPullDestinationAllowed(
        { adapter: "http_polling", environmentUrl: "https://attacker.example.com" },
        COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
      ),
    ).toThrow(/Power Platform environment address/);
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
