# Scenario

![scenario](https://github.com/langwatch/scenario/raw/refs/heads/main/assets/scenario-wide.webp)

[![npm version](https://badge.fury.io/js/%40langwatch%2Fscenario.svg)](https://badge.fury.io/js/%40langwatch%2Fscenario)

A powerful TypeScript library for testing AI agents in realistic, scripted scenarios.

Scenario provides a declarative DSL for defining test cases, allowing you to control conversation flow, simulate user behavior, and evaluate agent performance against predefined criteria.

## Features

- **Declarative DSL**: Write clear and concise tests with a simple, powerful scripting language.
- **Realistic Simulation**: Use the `userSimulatorAgent` to generate natural user interactions.
- **Automated Evaluation**: Employ the `judgeAgent` to automatically assess conversations against success criteria.
- **Flexible & Extensible**: Easily integrate any AI agent that conforms to a simple `AgentAdapter` interface.
- **Detailed Reporting**: Get rich results including conversation history, success/failure reasoning, and performance metrics.
- **TypeScript First**: Full type safety and autocompletion in your editor.

## Installation

```bash
pnpm add @langwatch/scenario
# or
npm install @langwatch/scenario
# or
yarn add @langwatch/scenario
```

## Quick Start

Create your first scenario test in under a minute.

```typescript
// echo.test.ts
import scenario, { type AgentAdapter, AgentRole } from "@langwatch/scenario";

// 1. Create an adapter for your agent
const echoAgent: AgentAdapter = {
  role: AgentRole.AGENT,
  call: async (input) => {
    // This agent simply echoes back the last message content
    const lastMessage = input.messages[input.messages.length - 1];
    return `You said: ${lastMessage.content}`;
  },
};

// 2. Define and run your scenario
async function testEchoAgent() {
  const result = await scenario.run({
    name: "Echo Agent Test",
    description: "The agent should echo back the user's message.",
    agents: [echoAgent],
    script: [
      scenario.user("Hello world!"),
      scenario.agent("You said: Hello world!"), // You can assert the agent's response directly
      scenario.succeed("Agent correctly echoed the message."),
    ],
  });

  if (result.success) {
    console.log("✅ Scenario passed!");
  } else {
    console.error(`❌ Scenario failed: ${result.reasoning}`);
  }
}

testEchoAgent();
```

## Usage with a Test Runner

Scenario integrates seamlessly with test runners like [Vitest](https://vitest.dev/) or [Jest](https://jestjs.io/). Here's a more advanced example testing an AI-powered weather agent.

```typescript
// weather.test.ts
import { describe, it, expect } from "vitest";
import { openai } from "@ai-sdk/openai";
import scenario, { type AgentAdapter, AgentRole } from "@langwatch/scenario";
import { generateText, tool } from "ai";
import { z } from "zod/v4";

describe("Weather Agent", () => {
  it("should get the weather for a city", async () => {
    // 1. Define the tools your agent can use
    const getCurrentWeather = tool({
      description: "Get the current weather in a given city.",
      parameters: z.object({
        city: z.string().describe("The city to get the weather for."),
      }),
      execute: async ({ city }) =>
        `The weather in ${city} is cloudy with a temperature of 24°C.`,
    });

    // 2. Create an adapter for your agent
    const weatherAgent: AgentAdapter = {
      role: AgentRole.AGENT,
      call: async (input) => {
        const response = await generateText({
          model: openai("gpt-4.1-mini"),
          system: `You are a helpful assistant that may help the user with weather information.`,
          messages: input.messages,
          tools: { get_current_weather: getCurrentWeather },
        });

        if (response.toolCalls && response.toolCalls.length > 0) {
          const toolCall = response.toolCalls[0];
          // Agent executes the tool directly and returns both messages
          const toolResult = await getCurrentWeather.execute(
            toolCall.input as { city: string },
            {
              toolCallId: toolCall.toolCallId,
              messages: input.messages,
            }
          );
          return [
            {
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolName: toolCall.toolName,
                  toolCallId: toolCall.toolCallId,
                  input: toolCall.input,
                },
              ],
            },
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolName: toolCall.toolName,
                  toolCallId: toolCall.toolCallId,
                  output: { type: "text", value: toolResult as string },
                },
              ],
            },
          ];
        }

        return response.text;
      },
    };

    // 3. Define and run your scenario
    const result = await scenario.run({
      name: "Checking the weather",
      description:
        "The user asks for the weather in a specific city, and the agent should use the weather tool to find it.",
      agents: [
        weatherAgent,
        scenario.userSimulatorAgent({ model: openai("gpt-4.1-mini") }),
      ],
      script: [
        scenario.user("What's the weather like in Barcelona?"),
        scenario.agent(),
        // You can use inline assertions within your script
        (state) => {
          expect(state.hasToolCall("get_current_weather")).toBe(true);
        },
        scenario.succeed("Agent correctly used the weather tool."),
      ],
    });

    // 4. Assert the final result
    expect(result.success).toBe(true);
  }, 30_000); // 30s test timeout
});
```

## Core Concepts

### `run(config)`

The main function to execute a scenario. It takes a configuration object and returns a promise that resolves with the final `ScenarioResult`.

### `ScenarioConfig`

The configuration object for a scenario.

- `name: string`: A human-readable name for the scenario.
- `description: string`: A detailed description of what the scenario tests.
- `agents: AgentAdapter[]`: A list of agents participating in the scenario.
- `script?: ScriptStep[]`: An optional array of steps to control the scenario flow. If not provided, the scenario will proceed automatically.
- `maxTurns?: number`: The maximum number of conversation turns before a timeout. Defaults to 10.
- `verbose?: boolean`: Enables detailed logging during execution.
- `setId?: string`: (Optional) Groups related scenarios into a test suite ("Simulation Set"). Useful for organizing and tracking scenarios in the UI and reporting. If not provided, the scenario will not be grouped into a set.

### Agents

Agents are the participants in a scenario. They are defined by the `AgentAdapter` interface.

```typescript
export interface AgentAdapter {
  role: AgentRole; // USER, AGENT, or JUDGE
  call: (input: AgentInput) => Promise<AgentReturnTypes>;
}
```

Scenario provides built-in agents for common testing needs:

- `userSimulatorAgent(config)`: Simulates a human user, generating realistic messages based on the scenario description.
- `judgeAgent(config)`: Evaluates the conversation against a set of criteria and determines if the scenario succeeds or fails.

### Scripting

Scripts provide fine-grained control over the scenario's execution. A script is an array of `ScriptStep` functions.

A `ScriptStep` is a function that receives the current `ScenarioExecutionState` and the `ScenarioExecutionLike` context.

**Built-in Script Steps:**

- `user(content?)`: A user turn. If `content` is provided, it's used as the message. Otherwise, the `userSimulatorAgent` generates one.
- `agent(content?)`: An agent turn. If `content` is provided, it's used as the message. Otherwise, the agent under test generates a response.
- `judge(content?)`: Forces the `judgeAgent` to make a decision.
- `message(message)`: Adds a specific `CoreMessage` to the conversation.
- `proceed(turns?, onTurn?, onStep?)`: Lets the scenario run automatically.
- `succeed(reasoning?)`: Ends the scenario with a success verdict.
- `fail(reasoning?)`: Ends the scenario with a failure verdict.

For voice tests, additional steps are available: `sleep(seconds)`, `silence(duration)`, `audio(pathOrBytes)`, `dtmf(tones)`, `interrupt(options)`, plus the non-blocking `agent({ wait: false })` and `voiceProceed({ interruptions })`. See the [TypeScript voice guide](https://scenario.langwatch.ai/voice/getting-started).

You can also provide your own functions as script steps for making assertions:

```typescript
import { expect } from "vitest";

const script = [
  user("Hello"),
  agent(),
  (state) => {
    // Make assertions on the state
    expect(state.lastAssistantMessage?.content).toContain("Hi there");
  },
  succeed(),
];
```

## Voice Agents

Scenario treats voice as a first-class citizen: same `scenario.run()` entrypoint, same script DSL, same judge — only the medium changes. You make a test a voice test by passing a voice-capable agent and a `voice` on the user simulator. Voice runs need the system `ffmpeg` on PATH (audio decode/transcode).

```typescript
import scenario, { userSimulatorAgent, judgeAgent } from "@langwatch/scenario";

const result = await scenario.run({
  name: "billing dispute",
  description: "Customer calls angry about a double charge; agent should de-escalate",
  agents: [
    scenario.pipecatAgent({ url: "ws://localhost:8765/ws" }),
    userSimulatorAgent({ voice: "openai/nova" }),
    judgeAgent({ criteria: ["Agent stays calm and offers a concrete resolution"] }),
  ],
  script: [
    scenario.user("I just got charged TWICE for my subscription!"),
    scenario.agent({ wait: false }), // non-blocking — agent starts speaking
    scenario.sleep(2),
    scenario.user("No, listen to me!"), // interrupts
    scenario.agent(),
    scenario.judge(),
  ],
});

expect(result.success).toBe(true);
```

**Shipped adapters** (factory on `scenario`, also exported as classes under the `voice` namespace): `scenario.pipecatAgent` (Pipecat WebSocket), `scenario.openAIRealtimeAgent` (model-as-agent + model-as-user-simulator via `role`), `scenario.geminiLiveAgent`, `scenario.elevenLabsAgent` (hosted ConvAI), `scenario.twilioAgent` (Media Streams), and `scenario.composableAgent` (bring-your-own STT + LLM + TTS). LiveKit / Vapi / generic WebRTC / generic WebSocket are Python-only for now and **not** exported in TS.

**Additional surface:** new script steps `scenario.sleep` / `scenario.silence` / `scenario.audio` / `scenario.dtmf` / `scenario.interrupt` (+ the non-blocking `scenario.agent({ wait: false })` turn, also exported as the alias `scenario.voiceAgent({ wait: false })`, and `scenario.voiceProceed({ interruptions })`); audio effects under `voice.effects` (`backgroundNoise`, `phoneQuality`, `packetLoss`, …); per-run provider config via `run({ voice: { stt, tts } })`; and `result.audio` / `result.timeline` / `result.latency` on the result.

- **Full TypeScript voice guide:** [scenario.langwatch.ai/voice/getting-started](https://scenario.langwatch.ai/voice/getting-started) — the real public API, mirroring the worked examples.
- **Capability matrix (TS):** [`docs/voice/capability-matrix.md`](./docs/voice/capability-matrix.md) — per-adapter features, wire formats, and the errors that reference them.
- **Recorded demos (audio evidence):** [`examples/vitest/outputs/recordings/README.md`](./examples/vitest/outputs/recordings/README.md) — `full.wav` + `manifest.json` per `@e2e` demo.

> The judge and the user simulator use LLMs — even for an ElevenLabs-only or Twilio-only test, an `OPENAI_API_KEY` is required for those (or swap them via `run({ voice })`).

## Configuration

You can configure project-wide defaults by creating a `scenario.config.js` or `scenario.config.mjs` file in your project root.

```js
// scenario.config.mjs
import { defineConfig } from "@langwatch/scenario/config";
import { openai } from "@ai-sdk/openai";

export default defineConfig({
  // Set a default model provider for all agents (e.g., userSimulatorAgent, judgeAgent)
  defaultModel: {
    model: openai("gpt-4o-mini"),
    temperature: 0.1,
  },
});
```

The library will automatically load this configuration.

### All Configuration Options

The following configuration options are all optional. You can specify any combination of them in your `scenario.config.js` file.

- `defaultModel` _(Optional)_: An object to configure the default AI model for all agents.
  - `model`: **(Required if `defaultModel` is set)** An instance of a language model from a provider like `@ai-sdk/openai`.
  - `temperature` _(Optional)_: The default temperature for the model (e.g., `0.1`).
  - `maxTokens` _(Optional)_: The default maximum number of tokens for the model to generate.

### Environment Variables

You can control the library's behavior with the following environment variables:

- `LOG_LEVEL`: Sets the verbosity of the internal logger. Can be `error`, `warn`, `info`, or `debug`. By default, logging is silent.
- `SCENARIO_DISABLE_SIMULATION_REPORT_INFO`: Set to `true` to disable the "Scenario Simulation Reporting" banner that is printed to the console when a test run starts.
- `LANGWATCH_API_KEY`: Your LangWatch API key. This is used as a fallback if `langwatchApiKey` is not set in your config file.
- `LANGWATCH_ENDPOINT`: The LangWatch reporting endpoint. This is used as a fallback if `langwatchEndpoint` is not set in your config file.

## Grouping Scenarios with setId

You can group related scenarios into a set ("Simulation Set") by providing the `setId` option. This is useful for organizing your scenarios in the UI and for reporting in LangWatch.

```typescript
const result = await scenario.run({
  name: "my first scenario",
  description: "A simple test to see if the agent responds.",
  setId: "my-test-suite", // Group this scenario into a set
  agents: [myAgent, scenario.userSimulatorAgent()],
});
```

This will group all scenarios with the same `setId` together in the LangWatch UI and reporting tools.

- The `setupFiles` entry enables Scenario's event logging for each test.
- The custom `VitestReporter` provides detailed scenario test reports in your test output.

## Vitest Integration

Scenario provides a convenient helper function to enhance your Vitest configuration with all the necessary setup files.

### Using the withScenario Helper (Recommended)

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { withScenario } from "@langwatch/scenario/integrations/vitest/config";
import VitestReporter from "@langwatch/scenario/integrations/vitest/reporter";

export default withScenario(
  defineConfig({
    test: {
      testTimeout: 180000, // 3 minutes, or however long you want to wait for the scenario to run
      // Your existing setup files will be preserved and run after Scenario's setup
      setupFiles: ["./my-custom-setup.ts"],
      // Your existing global setup files will be preserved and run after Scenario's global setup
      globalSetup: ["./my-global-setup.ts"],
      // Optional: Add the Scenario reporter for detailed test reports
      reporters: ["default", new VitestReporter()],
    },
  })
);
```

The `withScenario` helper automatically:

- Adds Scenario's setup files for event logging
- Adds Scenario's global setup files
- Preserves any existing setup configuration you have
- Handles both string and array configurations for setup files

### Manual Configuration

If you prefer to configure Vitest manually, you can add the Scenario setup files directly:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import VitestReporter from "@langwatch/scenario/integrations/vitest/reporter";

export default defineConfig({
  test: {
    testTimeout: 180000, // 3 minutes, or however long you want to wait for the scenario to run
    setupFiles: ["@langwatch/scenario/integrations/vitest/setup"],
    // Optional: Add the Scenario reporter for detailed test reports
    reporters: ["default", new VitestReporter()],
  },
});
```

This configuration:

- The `setupFiles` entry enables Scenario's event logging for each test
- The custom `VitestReporter` provides detailed scenario test reports in your test output (optional)

## Development

This project uses `pnpm` for package management.

### Getting Started

```bash
# Install dependencies
pnpm install

# Build the project
pnpm run build

# Run tests
pnpm test
```

## License

MIT

### SCENARIO_BATCH_RUN_ID

When running scenario tests, you can set the `SCENARIO_BATCH_RUN_ID` environment variable to uniquely identify a batch of test runs. This is especially useful for grouping results in reporting tools and CI pipelines.

Example:

```bash
SCENARIO_BATCH_RUN_ID=my-ci-run-123 pnpm test
```

If you use the provided test script, a unique batch run ID is generated automatically for each run.
