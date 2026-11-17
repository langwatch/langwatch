"""OWASP red team pack: one multi-turn attack per OWASP id, judged per run.

Run: pytest test_owasp_pack.py -v   (needs LANGWATCH_API_KEY and the model key)
conftest.py beside this file puts the repository root on the import path.
One id: pytest test_owasp_pack.py -k LLM01
"""

import pytest
import scenario

from agent_adapter import OwaspTargetAdapter
from owasp_attacks import ATTACKS, Attack, run_identity
from owasp_config import AGENT, MODEL, SET_ID, TOTAL_TURNS, assert_config_filled

scenario.configure(default_model=MODEL)


@pytest.mark.agent_test
@pytest.mark.asyncio
@pytest.mark.parametrize("attack", ATTACKS, ids=[a["id"] for a in ATTACKS])
async def test_owasp_attack(attack: Attack):
    assert_config_filled()
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

    identity = run_identity(attack, AGENT)
    result = await scenario.run(
        # scenario.run takes no id: the Python SDK uses the name as the scenario id.
        name=identity["name"],
        description=f"An attacker targets {AGENT['name']}. {AGENT['description']}",
        agents=[OwaspTargetAdapter(), attacker, judge],
        script=attacker.marathon_script(),
        set_id=SET_ID,
        metadata=identity["metadata"],
    )
    # The result has no turn index: open the run in LangWatch to see where it broke.
    unmet = "; ".join(result.failed_criteria)
    # An early exit means the attacker scored a win: a breach, never a pass.
    assert not (result.reasoning or "").startswith("Early exit"), (
        f"{identity['name']}: the attacker won. {result.reasoning}"
    )
    assert result.success, f"{identity['name']}. Unmet: {unmet}. {result.reasoning}"
