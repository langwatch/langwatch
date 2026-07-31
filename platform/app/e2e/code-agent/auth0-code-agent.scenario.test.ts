// LangWatch scenario proving a custom CODE AGENT can call an API behind
// Auth0 machine-to-machine auth. langwatch/langwatch#6337.
//
// The agent under test is NOT a mock and NOT hand-rolled HTTP: it is the real
// SerializedCodeAgentAdapter — the exact class the on-platform scenario worker
// uses to execute a code-agent target — pointed at a live nlpgo service, which
// runs the committed example Python (services/nlpgo/app/engine/blocks/
// codeblock/examples/auth0_code_agent.py) through the production runner.
//
// Two layers, per the e2e/langy convention:
//   Layer 1 — an LLM judge grades the conversation: the agent's answer must
//     carry a fact that ONLY exists behind the auth wall.
//   Layer 2 — in-test assertions on what the stub endpoints RECEIVED: the
//     client-credentials request, the minted Bearer token on the downstream
//     call, and the run-unique client secret appearing nowhere in the
//     conversation.
//
// PREREQUISITES:
//   - nlpgo running:  SERVER_ADDR=:5599 go run ./cmd/service nlpgo   (repo root)
//   - OPENAI_API_KEY in the environment (judge + user simulator)
//
// RUN:
//   cd langwatch/e2e/code-agent
//   NLP_SERVICE_URL=http://127.0.0.1:5599 npx vitest run auth0-code-agent.scenario.test.ts --reporter=verbose

import { readFileSync } from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SerializedCodeAgentAdapter } from "../../src/server/scenarios/execution/serialized-adapters/code-agent.adapter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NLP_SERVICE_URL = process.env.NLP_SERVICE_URL ?? "http://127.0.0.1:5599";

/** The committed canonical example — the exact file the Go tests execute. */
const EXAMPLE_PATH = path.resolve(
  __dirname,
  "../../../services/nlpgo/app/engine/blocks/codeblock/examples/auth0_code_agent.py",
);

/** A fact that exists ONLY behind the auth wall — the judge looks for it. */
const PROTECTED_FACT =
  "Order #1042 shipped from the Rotterdam warehouse on Tuesday and arrives Thursday before noon.";

const MINTED_TOKEN = "minted-token-3f9a1c";
const CLIENT_SECRET = `s3cr3t-must-not-leak-${Date.now()}`;

interface TokenRequest {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  audience?: string;
}

const received = {
  tokenRequests: [] as TokenRequest[],
  apiAuthHeaders: [] as string[],
};

let tokenServer: http.Server;
let apiServer: http.Server;
let tokenUrl: string;
let apiUrl: string;

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

beforeAll(async () => {
  // Stub Auth0 token endpoint: mints MINTED_TOKEN for the right credentials.
  tokenServer = http.createServer((req, res) => {
    void readBody(req).then((body) => {
      // Enforce the full token-request HTTP contract, not just a parseable
      // body: POST, the /oauth/token path, and a JSON content type.
      if (
        req.method !== "POST" ||
        req.url !== "/oauth/token" ||
        !(req.headers["content-type"] ?? "").startsWith("application/json")
      ) {
        res.writeHead(400).end(JSON.stringify({ error: "bad_request" }));
        return;
      }
      const parsed = JSON.parse(body) as TokenRequest;
      received.tokenRequests.push(parsed);
      if (parsed.client_secret !== CLIENT_SECRET) {
        res.writeHead(401).end(JSON.stringify({ error: "access_denied" }));
        return;
      }
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({ access_token: MINTED_TOKEN, token_type: "Bearer" }),
        );
    });
  });
  tokenUrl = `${await listen(tokenServer)}/oauth/token`;

  // Stub protected API: answers with the protected fact ONLY for the minted token.
  apiServer = http.createServer((req, res) => {
    void readBody(req).then(() => {
      if (req.method !== "POST" || req.url !== "/chat") {
        res.writeHead(400).end(JSON.stringify({ error: "bad_request" }));
        return;
      }
      received.apiAuthHeaders.push(req.headers.authorization ?? "");
      if (req.headers.authorization !== `Bearer ${MINTED_TOKEN}`) {
        res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ reply: PROTECTED_FACT }));
    });
  });
  apiUrl = `${await listen(apiServer)}/chat`;
});

beforeEach(() => {
  // The stub servers are shared across the file; without this reset the
  // first additional `it` would silently inherit a prior test's requests.
  received.tokenRequests = [];
  received.apiAuthHeaders = [];
});

afterAll(() => {
  tokenServer?.close();
  apiServer?.close();
});

const model = openai("gpt-5-mini");

describe("Auth0-protected custom code agent as a scenario target", () => {
  it("answers with data from behind the auth wall, without leaking the secret", async () => {
    // The exact config shape the scenario worker's data-prefetcher produces
    // for a code-agent target.
    const agent = new SerializedCodeAgentAdapter(
      {
        type: "code",
        agentId: "agent_auth0_example",
        code: readFileSync(EXAMPLE_PATH, "utf8"),
        // The conversation message is the agent's ONLY input; credentials and
        // endpoint coordinates all ride the secrets namespace, so the whole
        // configuration is expressible through Settings -> Secrets and the one
        // mapping below is creatable in the editor UI today (static value
        // mappings are not — langwatch/langwatch#6371).
        inputs: [{ identifier: "message", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        scenarioMappings: {
          message: { type: "source", sourceId: "scenario", path: ["input"] },
        },
        scenarioOutputField: "output",
        secrets: {
          AUTH0_CLIENT_ID: "test-client-id",
          AUTH0_CLIENT_SECRET: CLIENT_SECRET,
          AUTH0_TOKEN_URL: tokenUrl,
          AUTH0_AUDIENCE: "https://api.acme-scenario.internal",
          AUTH0_API_URL: apiUrl,
        },
      },
      NLP_SERVICE_URL,
      "test-api-key",
    );

    const result = await scenario.run({
      name: "auth0 code agent answers from behind the auth wall",
      description:
        "The user asks a customer-support agent about their order. The agent's backing API is protected by Auth0 machine-to-machine auth — the shipment details are only obtainable with a valid token.",
      agents: [
        agent,
        scenario.userSimulatorAgent({ model }),
        scenario.judgeAgent({
          model,
          criteria: [
            "The agent's reply contains the concrete shipment details (order #1042, Rotterdam warehouse, arriving Thursday) — information it can only have obtained from the protected API.",
            "The agent does NOT report an authentication or authorization error.",
            "The agent's reply is not empty.",
          ],
        }),
      ],
      script: [
        scenario.user("where is my order #1042?"),
        scenario.agent(),
        scenario.judge(),
      ],
    });

    // Layer 2 FIRST — the deterministic wire-level assertions run before the
    // judge gate, so ordinary LLM-judge non-determinism can never mask (or be
    // blamed for) a real regression in the credential exchange.
    //
    // Layer 2a — the token endpoint received a real client-credentials
    // exchange with the seeded identity.
    expect(received.tokenRequests.length).toBeGreaterThan(0);
    const tokenReq = received.tokenRequests[0]!;
    expect(tokenReq.grant_type).toBe("client_credentials");
    expect(tokenReq.client_id).toBe("test-client-id");
    expect(tokenReq.client_secret).toBe(CLIENT_SECRET);
    expect(tokenReq.audience).toBe("https://api.acme-scenario.internal");

    // Layer 2b — the downstream call carried the exact token minted this run.
    expect(received.apiAuthHeaders).toContain(`Bearer ${MINTED_TOKEN}`);

    // Layer 2c — the agent's answer carries the protected fact, and the
    // transcript does not carry the secret. NOTE: the no-secret check here is
    // a sanity check, not leak evidence — no code path in this test could put
    // the secret into `result.messages`, so it cannot fail on its own. The
    // load-bearing leak assertions live in the Go tests (stdout / stderr /
    // traceback of the actual execution).
    const transcript = JSON.stringify(result.messages ?? []);
    expect(transcript).toContain("Rotterdam");
    expect(transcript).not.toContain(CLIENT_SECRET);

    // Layer 1 — the judge's verdict on the conversation, gated last.
    if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
    expect(result.success).toBe(true);
  });
});
