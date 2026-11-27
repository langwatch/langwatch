"""OWASP red team pack: one multi-turn attack per OWASP id, judged per run.

Calls live models, so keep it out of the default run: add -m "not agent_test"
to your pytest addopts and run the pack with -m agent_test.
Run: pytest test_owasp_pack.py -v -m agent_test   (needs LANGWATCH_API_KEY and the model key)
One id: pytest test_owasp_pack.py -m agent_test -k LLM01
conftest.py beside this file puts the repository root on the import path.
"""

import pytest
import scenario

from agent_adapter import OwaspTargetAdapter
from owasp_attacks import ATTACKS, Attack, attacker_options, breach, run_identity
from owasp_config import AGENT, MODEL, SET_ID, TOTAL_TURNS, assert_config_filled

scenario.configure(default_model=MODEL)


@pytest.mark.agent_test
# One loop for the whole run: model clients cached across tests outlive a per-test loop.
@pytest.mark.asyncio(loop_scope="session")
@pytest.mark.parametrize("attack", ATTACKS, ids=[a["id"] for a in ATTACKS])
async def test_owasp_attack(attack: Attack):
    assert_config_filled()
    factory = (
        scenario.RedTeamAgent.goat
        if attack["strategy"] == "goat"
        else scenario.RedTeamAgent.crescendo
    )
    attacker = factory(
        model=MODEL,
        metaprompt_model=MODEL,
        **attacker_options(attack, AGENT, TOTAL_TURNS),
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
    failure = breach(identity["name"], result)
    assert failure is None, failure
