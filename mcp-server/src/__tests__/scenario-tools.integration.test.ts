import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initConfig } from "../config.js";

// --- Canned responses for scenario API endpoints ---

const CANNED_SCENARIOS_LIST = [
  {
    id: "scen_abc123",
    name: "Login Flow Happy Path",
    situation: "User attempts to log in with valid credentials",
    criteria: ["Responds with a welcome message", "Includes user name in greeting"],
    labels: ["auth", "happy-path"],
  },
  {
    id: "scen_def456",
    name: "Password Reset",
    situation: "User requests a password reset link",
    criteria: ["Sends reset email"],
    labels: ["auth"],
  },
];

const CANNED_SCENARIO_DETAIL = {
  id: "scen_abc123",
  name: "Login Flow Happy Path",
  situation: "User attempts to log in with valid credentials",
  criteria: ["Responds with a welcome message", "Includes user name in greeting"],
  labels: ["auth", "happy-path"],
};

const CANNED_SCENARIO_CREATED = {
  id: "scen_new789",
  name: "Login Flow Happy Path",
  situation: "User attempts to log in with valid creds",
  criteria: ["Responds with a welcome message", "Includes user name in greeting"],
  labels: ["auth", "happy-path"],
};

const CANNED_SCENARIO_UPDATED = {
  id: "scen_abc123",
  name: "Login Flow - Valid Credentials",
  situation: "User logs in with correct email and pass",
  criteria: [
    "Responds with welcome message",
    "Sets session cookie",
    "Redirects to dashboard",
  ],
  labels: ["auth", "happy-path"],
};

const CANNED_SCENARIO_ARCHIVED = {
  id: "scen_abc123",
  archived: true,
};

// --- Mock HTTP Server ---

function createMockServer(): Server {
  return createServer((req, res) => {
    const authToken = req.headers["x-auth-token"];
    if (authToken !== "test-integration-key") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Invalid auth token." }));
      return;
    }

    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      res.setHeader("Content-Type", "application/json");

      // GET /api/scenarios - list all scenarios
      if (url === "/api/scenarios" && req.method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_SCENARIOS_LIST));
      }
      // GET /api/scenarios/:id - get scenario detail
      else if (
        url.match(/^\/api\/scenarios\/scen_abc123(\?|$)/) &&
        req.method === "GET"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_SCENARIO_DETAIL));
      }
      // GET /api/scenarios/:id - not found
      else if (
        url.match(/^\/api\/scenarios\/scen_nonexistent(\?|$)/) &&
        req.method === "GET"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Scenario not found" }));
      }
      // POST /api/scenarios - create scenario
      else if (url === "/api/scenarios" && req.method === "POST") {
        const parsed = JSON.parse(body);
        if (!parsed.name) {
          res.writeHead(400);
          res.end(JSON.stringify({ message: "Validation error: name is required" }));
        } else {
          res.writeHead(201);
          res.end(JSON.stringify(CANNED_SCENARIO_CREATED));
        }
      }
      // PUT /api/scenarios/:id - update scenario
      else if (
        url.match(/^\/api\/scenarios\/scen_abc123$/) &&
        req.method === "PUT"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_SCENARIO_UPDATED));
      }
      // PUT /api/scenarios/:id - not found
      else if (
        url.match(/^\/api\/scenarios\/scen_nonexistent$/) &&
        req.method === "PUT"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Scenario not found" }));
      }
      // DELETE /api/scenarios/:id - archive scenario
      else if (
        url.match(/^\/api\/scenarios\/scen_abc123$/) &&
        req.method === "DELETE"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_SCENARIO_ARCHIVED));
      }
      else {
        res.writeHead(404);
        res.end(
          JSON.stringify({ message: `Not found: ${req.method} ${url}` })
        );
      }
    });
  });
}

// --- Integration Tests ---
// These verify that MCP tool handlers correctly communicate with the REST API
// (auth, HTTP methods, status codes, error propagation).
// Formatting/digest logic is tested in scenario-tools.unit.test.ts.

describe("MCP scenario tools integration", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createMockServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        initConfig({
          apiKey: "test-integration-key",
          endpoint: `http://localhost:${port}`,
        });
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("list_scenarios", () => {
    describe("when the API returns scenarios", () => {
      it("returns a non-empty result", async () => {
        const { handleListScenarios } = await import(
          "../tools/list-scenarios.js"
        );
        const result = await handleListScenarios({});
        expect(result.length).toBeGreaterThan(0);
      });
    });

    describe("when format is json", () => {
      it("returns parseable JSON matching the API response", async () => {
        const { handleListScenarios } = await import(
          "../tools/list-scenarios.js"
        );
        const result = await handleListScenarios({ format: "json" });
        expect(JSON.parse(result)).toEqual(CANNED_SCENARIOS_LIST);
      });
    });
  });

  describe("get_scenario", () => {
    describe("when the scenario exists", () => {
      it("returns a non-empty result", async () => {
        const { handleGetScenario } = await import(
          "../tools/get-scenario.js"
        );
        const result = await handleGetScenario({ scenarioId: "scen_abc123" });
        expect(result.length).toBeGreaterThan(0);
      });
    });

    describe("when the scenario does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleGetScenario } = await import(
          "../tools/get-scenario.js"
        );
        await expect(
          handleGetScenario({ scenarioId: "scen_nonexistent" })
        ).rejects.toThrow("404");
      });
    });
  });

  describe("create_scenario", () => {
    describe("when valid data is provided", () => {
      it("returns confirmation with new scenario ID", async () => {
        const { handleCreateScenario } = await import(
          "../tools/create-scenario.js"
        );
        const result = await handleCreateScenario({
          name: "Login Flow Happy Path",
          situation: "User attempts to log in with valid creds",
          criteria: ["Responds with a welcome message", "Includes user name in greeting"],
          labels: ["auth", "happy-path"],
        });
        expect(result).toContain("scen_new789");
      });
    });

    describe("when name is empty", () => {
      it("propagates the validation error", async () => {
        const { handleCreateScenario } = await import(
          "../tools/create-scenario.js"
        );
        await expect(
          handleCreateScenario({
            name: "",
            situation: "Some situation",
          })
        ).rejects.toThrow();
      });
    });
  });

  describe("update_scenario", () => {
    describe("when the scenario exists", () => {
      it("returns a non-empty result", async () => {
        const { handleUpdateScenario } = await import(
          "../tools/update-scenario.js"
        );
        const result = await handleUpdateScenario({
          scenarioId: "scen_abc123",
          name: "Login Flow - Valid Credentials",
        });
        expect(result.length).toBeGreaterThan(0);
      });
    });

    describe("when the scenario does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleUpdateScenario } = await import(
          "../tools/update-scenario.js"
        );
        await expect(
          handleUpdateScenario({
            scenarioId: "scen_nonexistent",
            name: "Updated Name",
          })
        ).rejects.toThrow("404");
      });
    });
  });

  describe("archive_scenario", () => {
    describe("when the scenario exists", () => {
      it("returns confirmation that scenario was archived", async () => {
        const { handleArchiveScenario } = await import(
          "../tools/archive-scenario.js"
        );
        const result = await handleArchiveScenario({
          scenarioId: "scen_abc123",
        });
        expect(result).toContain("archived");
      });
    });
  });
});
