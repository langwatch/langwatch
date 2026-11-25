"""
The agent registry's change feed and an agent's versions read an event type a later
server release adds as a plain string, instead of raising on the whole page.

The generator makes a closed Enum of every enum, so scripts/spec-for-python-generator.py
opens the registry event `type` to the Enum or a string.

The fields added with posture (dormant, posture, platform, labels, owner_label) are optional
in the generator's copy, so a page from a server that predates them still reads.
"""

from typing import Any

import pytest

from langwatch.generated.langwatch_rest_api_client.models.get_api_governance_registry_agents_by_id_versions_response_200_data_item import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItem,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_type import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemType,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_governance_registry_events_response_200_data_item import (
    GetApiGovernanceRegistryEventsResponse200DataItem,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_governance_registry_events_response_200_data_item_type import (
    GetApiGovernanceRegistryEventsResponse200DataItemType,
)

pytestmark = pytest.mark.unit

AGENT: dict[str, Any] = {
    "id": "agentreg_1",
    "source": "databricks",
    "management": "discovered",
    "kind": "genie_space",
    "name": "Support tickets",
    "description": None,
    "status": "active",
    "shadow": False,
    "version": 1,
    "source_version": None,
    "project_id": None,
    "environment": None,
    "owner": None,
    "endpoints": [],
    "model": None,
    "instructions": None,
    "capabilities": ["genie_space"],
    "tools": [],
    "first_seen_at": "2026-11-12T00:00:00.000Z",
    "last_seen_at": None,
    "updated_at": "2026-11-12T00:00:00.000Z",
    "removed_at": None,
    "dormant": False,
    "posture": "governed",
    "platform": None,
    "labels": {},
    "owner_label": None,
}

AGENT_BEFORE_POSTURE: dict[str, Any] = {
    key: value
    for key, value in AGENT.items()
    if key not in ("dormant", "posture", "platform", "labels", "owner_label")
}


def event(event_type: str, agent: dict[str, Any] = AGENT) -> dict[str, Any]:
    return {
        "id": "agentreg_2",
        "sequence": "42",
        "type": event_type,
        "organization_id": "org_1",
        "agent_id": "agentreg_1",
        "from_version": None,
        "to_version": 1,
        "tool": None,
        "occurred_at": "2026-11-12T00:00:00.000Z",
        "agent": agent,
    }


@pytest.mark.parametrize(
    ("model", "known"),
    [
        (
            GetApiGovernanceRegistryEventsResponse200DataItem,
            GetApiGovernanceRegistryEventsResponse200DataItemType,
        ),
        (
            GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItem,
            GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemType,
        ),
    ],
)
class TestRegistryEventType:
    def test_reads_a_known_type_as_the_enum(self, model: Any, known: Any) -> None:
        parsed = model.from_dict(event("governance.agent.registered"))
        assert parsed.type_ is known.GOVERNANCE_AGENT_REGISTERED

    def test_reads_a_type_a_later_release_adds_as_a_string(
        self, model: Any, known: Any
    ) -> None:
        parsed = model.from_dict(event("governance.agent.a_later_release_type"))
        assert parsed.type_ == "governance.agent.a_later_release_type"
        assert parsed.to_dict()["type"] == "governance.agent.a_later_release_type"

    def test_reads_an_agent_from_a_server_before_posture(
        self, model: Any, known: Any
    ) -> None:
        parsed = model.from_dict(event("governance.agent.registered", AGENT_BEFORE_POSTURE))
        assert parsed.agent.name == "Support tickets"
        assert "dormant" not in parsed.to_dict()["agent"]
