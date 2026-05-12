hey there, this orchestration won't be something usual in software development of langwatch, but something else
You probably know already, but I want you to learn all about Skills, you know from agentskills standard (https://agentskills.io/llms.txt) and supported by tools like https://skills.sh/

Basically, we are renovating and disrupting completely how we do onboarding at LangWatch. Before, we would give people instructions on how to instrument their code based on the framework they were using, with code snippets, tell them to setup api key, or tell them to get started with scenarios, get started with the first evaluations etc. Now, we are in 2026, people are operating everything via agents such as yourself, specially claude code, and they don't want and dont expect to do anything by hand anymore, they just want to use a skill that do it for them, an mcp that powers the agent, and even better, a simple prompt they can copy and paste that sets up all that.

Now, the big challenge for us, is building those skills and knowing that they are going to work, for several cases, that the prompt and skills md files we give people are good and get the agent integrating their codebase or their flow correctly and doesn't get confused and lost. Luckily for us, we built exactly the best tool in the market to guarantee that: LangWatch Scenario. With LangWatch Scenario we can write agent simulations tests, this is exactly what we did on our mcp-server/ for example, we use a scenario test to test that our MCP works well by running it via claude code, letting it instrument a fixture codebase

Now, we have ambitious goals with this, and it should be very reliable, and we should be able to keep compounding and building on top of it, so it is of utmost importance that we think super well the whole organizational archicture of this. All that I'm saying here I want you to capture in specs/ of course so we plan and thing, but what I really want is to create a skills/ folder on langwatch, this will be our powerful skills project that condenses it all.

The architecture for it needs to be very well thought to accomodate all use cases and combinations and being testable and provable of quality, extensible and compoundable like I said, as I explain the use cases it will be clearer:

We want to renovate our onboarding to have four paths, and in each of those four paths, they will have a prompt/skill which allows them to:

- Devs using claude code
    - "Instrument my code with LangWatch"
    - "Create an evaluation experiment for my agent" (jupyter notebooks if in python, script if typescript)
    - "Add agent simulation tests for my agent"
    - "Version my agent prompts"
    - "Red team my agent for vulnerabilities"
    - "All of the above, take my agent to the next level"

- PMs using claude on the web
    - "Create an experiment to test my prompt"
    - "Write scenario simulation tests for my agent"
    - "Tell me how my agent has been performing"

- PMs via the platform
    - Create experiments, scenarios, prompt playground etc, but all clickops

- Devs manual setup
    - Current onboarding instructions pretty much


So, as you can see, its a lot of skills, an in each of them a lot of different situations to test already, for example instrumentation can be python or typescript, can be langgraph or agno, vercel or mastra, etc, experiment can be for a RAG, or it can be for an image classifier, agent simulation can be a conversational agent, or a analytics sql queriying agent, and so on

We already got most of this somehow, our MCP does a lot, you have access to it, so you can see, it lives in /mcp-server folder, and it will be a big part of it, since it give access to docs in md formats, allowing the agent to learn everything on how to create experiments, use the langwatch prompt cli, read scenario docs, etc

But also, the MCP has tools to create stuff in the platform directly, like prompts, scenarios etc, for the PM case using claude on the web, where they have a low-code environment. It's not complete though, "Create an experiment to test my prompt" cannot be fully done because although we can create the prompts and evaluators itself, we can't create UI experiments nor datasets via the mcp yet

So the MCP is one of the key parts of it, so I want the prompts we give people to try and install the langwatch MCP for them, so their agent always have access to docs etc, but I would also teach on the prompt/in a skill itself how to query the index llms.txt then the markdown files etc so if mcp installation fails for whatever reason it can probably proceed, at least in the dev case

For you to be able to handle all that you need to learn about langwatch platform too, so do use the MCP to learn about langwatch from the docs and scenario too

Then, a second big part we already have as well, is ~/Projects/remote/better-agents. Better Agents is a CLI we built to kick-off agent projects from scratch, and we did it by combining eg a framework to start a Google ADK project + a bunch of prompts from our side to get it fully with prompt versioning using our prompts cli, with a jupyter notebook experiment for an initial dataset and evaluation example, with scenarios, and telling the agent to keep runing it until it managed to pass all the tests and deliver the final solution

So I want you to learn from that, big time, not only reading the code and the prompt templates we have there, but a key point is to read every commit message that changed one of those prompts, and get the lessons learned from there, and do the same with the MCP server. There are a lot of lessons learned there, for example that the assistants would hallucinate and invent a "agent simulation testing" framework by its own, instead of reading scenario docs, or that it would not understand how to use prompts CLI and prompts.json and lock file properly and just duplicate the prompt in the code and the yaml files, defeating the purpose, or that it would not try to execute the jupyter notebook with the help of a script to prove it works, or not setting up the api key correctly, or using the mcp to create scenarios instead of writing in code when it was clearly a code-dev environment (that's why we prepended the tool calls with platform_ and tried to explain for example, but that's still confusing to the agent a lot of times)

Anyway as you can see there is a lot to test, most of those learnings from better-agents and mcp so far were us vibe-checking it and putting to the prompt and testing manually, but you can see now how we need a proper structrue and a structured approach. If every skill improvement should have a test scenario demonstrating it, then we can be confident in keep expanding and compounding

Talking about compounding, so, I've been saying skills because that is the thing with the best structure, and community standards, and we want to document and publish the skills for people to use directly. However, we also want people to not to have to even learn about what the heck a SKILL.md is, so we also want a process to generate ready to copy prompts out of those skills, so people just literally copy and paste on their agents. This copy and paste can be a combination of skills for example, to achieve the goals described above. Our idea is that on the onboarding page they will have 3 options: Prompts (the default one), Skills (so basically same abilities by we show them how to install and use our skills instead, for those people that know about skills and like to be more organized), and manual MCP installation (then no 'goals' or ready to copy prompts, we just tell them what they can ask and do with the mcp)

I have another engineer working on the frontend of this new onboarding flow on the new /onboarding pages, but, we need much more than that. This onboarding workflow needs to be everywhere, from our docs, we want all our initial pages and getting started to reflect the same flow for example, devs using claude code / pms using claude code on the web / pms via the platform / devs manual setup (of course we don't literally use those as copy just to be clear, this is our internal naming), and there on the docs also we will have the prompts to copy, the published skills and how they can install it and so on

But also inside the platform right, if they have no traces yet, instead of a blank screen we can offer them to copy and paste a prompt to get started. If they go to datasets or evaluators and it is empty, same thing, we offer them the prompt or skill option (or click + Add too, if they want to do the current way ofc)

So, I hope you get it, this is our complete strategy, end to end, from all angles, on all our touch points, we can't leave any gaps, this means for example on the docs review every single page and see if there is any getting started anywhere and link them back to the pages telling about the prompt/skills, so it's all interconnected

Now about API key, that's a very important aspect to mind as well, always kind of a challenge. I'm thinking on this skill to compiled prompts generation, we should generate a prompt with a placeholder for api key, so that on the onboarding/first setup pages of the platform, they can literally just copy and paste a single thing, and the agent receiving it already puts the api key when installing the mcp, adds it to the .env file etc, but on the docs for example, maybe there should be a line telling the agent to ask the user back for their langwatch api key, telling them to visit https://app.langwatch.ai/authorize

Now for the tests, those scenario tests for the skills/ should really be langwatch e2e, to speed thigns up up you can point against production (I have this api key for you <api key on .env already>), and claude code e2e (I have my account signed up)

The skills are going to start as those initial setups, but later we want to expand to more granular use cases, for example I had customers asking me already "do you have a skill to help me test my voice agent with langwatch?"

now reflect on all I said, explore agentskills, better-agents, our mcp, langwatch and scenario docs, review and think deeply about all the use cases and how to better structure this

go