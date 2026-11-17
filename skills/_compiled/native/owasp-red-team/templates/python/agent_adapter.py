"""Connects the OWASP pack to the agent under test. Wire call_agent and nothing else."""

import scenario


async def call_agent(messages: list) -> scenario.AgentReturnTypes:
    """Run your agent on the conversation so far and return its reply.

    `messages` is the OpenAI-style message list of the whole conversation.
    Return a string, one message dict, or the list of new messages. Return the
    tool call and tool result messages too: the judge needs them to see tool use.
    """
    # Example: from my_app.agent import run_agent; return await run_agent(messages)
    raise NotImplementedError(
        "Wire your agent in agent_adapter.call_agent before running the OWASP pack"
    )


class OwaspTargetAdapter(scenario.AgentAdapter):
    async def call(self, input: scenario.AgentInput) -> scenario.AgentReturnTypes:
        return await call_agent(input.messages)
