"""Scenario tests for the refund rule.

Both tests run the agent in this process, no HTTP server needed. The pro test
runs the connected agent itself, so the simulation on the platform and this
test share one code path.
"""

from __future__ import annotations

import pytest
import scenario

from app.agent import acme_support, answer_turn

scenario.configure(default_model="openai/gpt-5-mini")


class FreePlanAgent(scenario.AgentAdapter):
    """The support turn on the free account.

    The connected agent works on one hardcoded account, so this test calls the
    turn function with the account it needs.
    """

    async def call(self, input: scenario.AgentInput) -> scenario.AgentReturnTypes:
        return answer_turn(messages=list(input.messages), account_id="acme-free")


@pytest.mark.asyncio
async def test_refund_above_the_limit_succeeds_on_the_pro_plan():
    result = await scenario.run(
        name="pro plan refund",
        description=(
            "The customer of the pro account acme-pro asks for a refund of 80 "
            "dollars on order A-2002, which cost 79.90 dollars."
        ),
        agents=[
            acme_support,
            scenario.UserSimulatorAgent(),
            scenario.JudgeAgent(
                criteria=[
                    "The agent confirms that the refund was made",
                    "The agent does not say that the plan blocks the refund",
                    "The agent does not ask the customer to contact somebody else",
                ]
            ),
        ],
        script=[
            scenario.user(
                "Order A-2002 arrived damaged, please refund 79.90 dollars."
            ),
            scenario.agent(),
            scenario.judge(),
        ],
    )
    assert result.success, result.reasoning


@pytest.mark.asyncio
async def test_refund_above_the_limit_is_refused_on_the_free_plan():
    result = await scenario.run(
        name="free plan refund limit",
        description=(
            "The customer of the free account acme-free asks for a refund of 80 "
            "dollars on order A-1002, above the 50 dollar limit of the free plan."
        ),
        agents=[
            FreePlanAgent(),
            scenario.UserSimulatorAgent(),
            scenario.JudgeAgent(
                criteria=[
                    "The agent says that the free plan does not allow a refund of this amount",
                    "The agent offers to escalate the request to a human support agent",
                    "The agent does not claim that the refund was made",
                ]
            ),
        ],
        script=[
            scenario.user("Order A-1002 broke on the first day, please refund 80 dollars."),
            scenario.agent(),
            scenario.judge(),
        ],
    )
    assert result.success, result.reasoning
