---
active: true
iteration: 1
session_id: 
max_iterations: 0
completion_promise: null
started_at: "2026-04-13T22:14:21Z"
---

hey there, so we are changing our entire company direction to be agentic first, and for that, we made it a prime directive that every single of our features should be fully covered on the six pilars:

- API
- SDK
- CLI
- Docs
- MCP
- Skills

the APIs are Hono endpoints, backed by the service and repository layers so that tRPC endpoints can also use it, and they generate API specs which in turn are generated to be used by the python-sdk/ and typescript-sdk/. CLI should equally give access to everything via the command line with ◇ injected env (0) from .env // tip: ◈ secrets for agents [www.dotenvx.com], it's built along on the typescript-sdk/. Docs should cover all the four big unified theory of documentation. Reference is just basic should also be OpenAPI generated, but on our main docs section we should have markdowns written on all the features and how to use it, with explanations, perhaps pointing to the CLI command as well or SDK usage depending on what makes more sense to use, we are good on docs but there are always some gaps. MCP lives on the mcp-server/ and should basically give access to everything like the cli and api does, but exposed as tools for the agents in environments where it cant use the cli. Skills are the latest addition to the team but most powerful, they should cover everything the docs doesn't, which is filling the behavioural gaps for agents to do things the right way, the most important part of the skills/ folder is the scenario tests that really validate that Claude Code can use them correctly.

so, we have created a feature-map.json file at the root of the project, so we keep track of everything on those six dimensions as well, and can generate a FEATURE-MAP.md report which later will be our full map for everything which we can for example just throw into an LLM's hands, and we also have a /feature-map skill on how to update it as you go and update it.

so, the task is, I need you to COMPLETELY IMPLEMENT ALL OUR FEATURES, literally everything, completely, complete coverage, of every single feature in the platform, everything tested, and retested, compoletely covered with integration tests, actually calling the database for the api, e2e for the CLI, actually calling langwatch, scenario tests, actually using claude code to run the skill and verifying a full usage or implementation took place and so on, after you are done, for sure you will have more to cover that you didn't, corner features, improvement in ergonomics for the CLI, and so on

by the way, we want the CLI to be the main way the agent uses us and not the MCP anymore like the current skills do, so scenario test the behaviour of the agent also with CLI at hand and improve the ergonomics and non-interactive mode for it also as you implement and loop

for the CRUDs, everything should be coverable easily and as much standardized as possible. From the Hono endpoints we can create openapi specs that will go to sdks, docs, and cli commands. However, there are a lot of additional functionalities that are more handmade and carefully concerned. For example the whole prompt sync and label tagging and so on is a big one, but also dataset upload for example, it's a more intricate one. Maybe for evaluators, agents, workflows, and prompts we will want to be able to execute them from the CLI with example inputs to test them out, and so on

recent PRs we done in this direction as examples:
- https://github.com/langwatch/langwatch/pull/2925 (it also adds the CLI this one)
- https://github.com/langwatch/langwatch/pull/2926
- https://github.com/langwatch/langwatch/pull/2982
- https://github.com/langwatch/langwatch/pull/3099

load the /orchestrate skill in memory so you learn how we work, with specs/ and so on. btw examples/ folder on typescript-sdk might be broken on some pnpm installations because of pnpm workspaces thingie you might have to fix

keep going, keep testing everything works perfectly, keep finding more features our platform provides but not our CLI and APIs, keep creating powerful skills where it makes sense and still proving with scenario that claude can use our platform for every sing functionality, and proceed, keep improving, keep covering, leave no stone unturned
