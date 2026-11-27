"""Runs the Python pack's test function as shipped, with stub pytest and scenario modules.

The stub SDK plays the published one's early exit: an attacker built without
success_score=None wins on its own score. argv: pack dir, config (shipped or
example), judge verdict (held or breach). Prints one JSON outcome per attack.
"""

import asyncio
import json
import sys
import types

pack_dir, config, verdict = sys.argv[1:4]
sys.path.insert(0, pack_dir)


marks = []


class _Marks:
    def __getattr__(self, name):
        def mark(*args, **kwargs):
            marks.append(name)
            if len(args) == 1 and callable(args[0]) and not kwargs:
                return args[0]
            return lambda fn: fn

        return mark


pytest = types.ModuleType("pytest")
pytest.mark = _Marks()
sys.modules["pytest"] = pytest

runs = []
scenario = types.ModuleType("scenario")
scenario.configure = lambda **kwargs: None
scenario.AgentInput = object
scenario.AgentReturnTypes = object


class AgentAdapter:
    pass


class Attacker:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def marathon_script(self):
        return []


class RedTeamAgent:
    goat = Attacker
    crescendo = Attacker


class JudgeAgent:
    def __init__(self, *, model, criteria):
        self.criteria = criteria


async def run(*, name, agents, set_id, metadata, **_):
    adapter, attacker, judge = agents
    reply = await adapter.call(types.SimpleNamespace(messages=[{"role": "user", "content": "hi"}]))
    runs.append({"name": name, "set_id": set_id, "metadata": metadata, "reply": reply})
    if "success_score" not in attacker.kwargs or attacker.kwargs["success_score"] is not None:
        return types.SimpleNamespace(
            success=True, reasoning="Early exit: objective achieved on turn 2", failed_criteria=[]
        )
    held = verdict == "held"
    return types.SimpleNamespace(
        success=held,
        reasoning="The agent held." if held else "The agent broke.",
        failed_criteria=[] if held else judge.criteria,
    )


scenario.AgentAdapter = AgentAdapter
scenario.RedTeamAgent = RedTeamAgent
scenario.JudgeAgent = JudgeAgent
scenario.run = run
sys.modules["scenario"] = scenario

import agent_adapter  # noqa: E402
import owasp_config  # noqa: E402


async def refuse(messages):
    return "I can only help with your own orders."


agent_adapter.call_agent = refuse
if config == "example":
    owasp_config.AGENT.clear()
    owasp_config.AGENT.update(owasp_config.EXAMPLE_AGENT)

import test_owasp_pack  # noqa: E402

outcomes = []
for attack in test_owasp_pack.ATTACKS:
    try:
        asyncio.run(test_owasp_pack.test_owasp_attack(attack))
        outcomes.append({"id": attack["id"], "failure": None})
    except AssertionError as error:
        outcomes.append({"id": attack["id"], "failure": str(error)})
    except owasp_config.OwaspConfigError as error:
        outcomes.append({"id": attack["id"], "failure": error.code})
print(json.dumps({"outcomes": outcomes, "runs": runs, "marks": marks}))
