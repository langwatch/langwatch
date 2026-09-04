"""The six scenarios the agent is optimized against.

Each one is a `dspy.Example`. The inputs are the scenario definition, so a DSPy
optimizer sees the suite as its trainset and its valset.

`criteria` mixes outcome and process. Outcome criteria say what the customer
must end up with, process criteria say how the agent is allowed to get there.
The process ones are what push the optimizer to rewrite the tool descriptions
instead of only the persona.

`budget_steps` is the number of steps the scenario should need, where a step
is one agent reply or one tool call. A tool call that gets rejected and retried
is an extra step. The metric in `program.py` subtracts from the score when a
run goes over the budget.
"""

from __future__ import annotations

# scenario is imported before dspy, see the note in agent.py.
import scenario
import dspy

scenario.configure(default_model="openai/gpt-5-mini", max_turns=12)

SCENARIOS = [
    {
        "name": "damaged blender refund",
        "description": (
            "The customer received a damaged blender, order 1001, and wants a refund "
            "to the original payment method. They have the order number ready and are "
            "polite but in a hurry."
        ),
        "criteria": [
            "The agent creates the return for order 1001",
            "The agent confirms the refund goes back to the original payment method",
            "The agent does not call check_return_eligibility more than once with the same order",
            "The agent does not ask the customer for the order number more than once",
        ],
        "budget_steps": 5,
    },
    {
        "name": "return outside the window",
        "description": (
            "The customer wants to return order 1002, a tower fan that was delivered "
            "60 days ago, because they changed their mind. They insist a little when "
            "told no."
        ),
        "criteria": [
            "The agent refuses the return and says the 30 day window has passed",
            "The agent stays polite and does not blame the customer",
            "The agent does not create a return for order 1002",
            "The agent does not promise a refund it cannot give",
        ],
        "budget_steps": 4,
    },
    {
        "name": "misremembered order number",
        "description": (
            "The customer says their order is 1007 and wants to return a backpack. "
            "No order 1007 exists. The backpack is order 1003. The customer only "
            "remembers it was a blue backpack."
        ),
        "criteria": [
            "The agent tells the customer that order 1007 was not found",
            "The agent finds the backpack order 1003 or asks a question that leads to it",
            "The agent does not invent details about order 1007",
        ],
        "budget_steps": 5,
    },
    {
        "name": "angry customer wants store credit",
        "description": (
            "The customer is angry: order 1003 arrived as the wrong item, a backpack "
            "in the wrong colour. They want store credit rather than a refund to the "
            "card, and they say so in their first message."
        ),
        "criteria": [
            "The agent creates the return for order 1003 with store credit as the refund method",
            "The agent acknowledges the mistake without arguing",
            "The agent does not retry a tool call with an invalid argument value",
            "The agent confirms the refund method back to the customer",
        ],
        "budget_steps": 5,
    },
    {
        "name": "expedited refund request",
        "description": (
            "A frequent customer wants the refund for their damaged blender, order "
            "1001, paid out before the item reaches the warehouse. ACME does not do "
            "that, refunds are paid on arrival."
        ),
        "criteria": [
            "The agent explains that the refund is paid once the item arrives at the warehouse",
            "The agent still creates the return for order 1001",
            "The agent does not promise an early payout",
        ],
        "budget_steps": 5,
    },
    {
        "name": "unrelated question",
        "description": (
            "The customer asks the support agent for a recipe for banana bread, then "
            "asks whether ACME sells flour."
        ),
        "criteria": [
            "The agent says it only helps with orders and returns",
            "The agent does not call any tool",
            "The agent stays short and does not lecture the customer",
        ],
        "budget_steps": 2,
    },
]

trainset = [
    dspy.Example(**s).with_inputs("name", "description", "criteria", "budget_steps")
    for s in SCENARIOS
]
