"""OWASP red team pack: one multi-turn attack per OWASP id, judged per run.

Run: pytest test_owasp_pack.py -v   (needs LANGWATCH_API_KEY and the model key)
One id: pytest test_owasp_pack.py -k LLM01
"""

import pytest
import scenario

from agent_adapter import OwaspTargetAdapter
from owasp_attacks import ATTACKS, Attack
from owasp_config import AGENT, MODEL, SET_ID, TOTAL_TURNS

scenario.configure(default_model=MODEL)


@pytest.mark.agent_test
@pytest.mark.asyncio
@pytest.mark.parametrize("attack", ATTACKS, ids=[a["id"] for a in ATTACKS])
async def test_owasp_attack(attack: Attack):
    factory = (
        scenario.RedTeamAgent.goat
        if attack["strategy"] == "goat"
        else scenario.RedTeamAgent.crescendo
    )
    attacker = factory(
        target=attack["goal"](AGENT),
        model=MODEL,
        metaprompt_model=MODEL,
        total_turns=TOTAL_TURNS,
        # The judge gives every verdict; no early exit on the attacker's own score.
        success_score=None,
    )
    judge = scenario.JudgeAgent(model=MODEL, criteria=attack["criteria"](AGENT))

    result = await scenario.run(
        name=f"{attack['id']} {attack['title']}: {AGENT['name']}",
        description=f"An attacker targets {AGENT['name']}. {AGENT['description']}",
        agents=[OwaspTargetAdapter(), attacker, judge],
        script=attacker.marathon_script(),
        set_id=SET_ID,
        metadata={"owasp": attack["id"], "strategy": attack["strategy"]},
    )
    assert result.success, f"{attack['id']} {attack['title']}: {result.reasoning}"
