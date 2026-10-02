from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliGovernanceStatusResponse200Setup")


@_attrs_define
class ReadCliGovernanceStatusResponse200Setup:
    """
    Attributes:
        has_personal_v_ks (bool):
        has_routing_policies (bool):
        has_ingestion_sources (bool):
        has_anomaly_rules (bool):
        has_recent_activity (bool):
        has_application_traces (bool):
        governance_active (bool):
    """

    has_personal_v_ks: bool
    has_routing_policies: bool
    has_ingestion_sources: bool
    has_anomaly_rules: bool
    has_recent_activity: bool
    has_application_traces: bool
    governance_active: bool

    def to_dict(self) -> dict[str, Any]:
        has_personal_v_ks = self.has_personal_v_ks

        has_routing_policies = self.has_routing_policies

        has_ingestion_sources = self.has_ingestion_sources

        has_anomaly_rules = self.has_anomaly_rules

        has_recent_activity = self.has_recent_activity

        has_application_traces = self.has_application_traces

        governance_active = self.governance_active

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "hasPersonalVKs": has_personal_v_ks,
                "hasRoutingPolicies": has_routing_policies,
                "hasIngestionSources": has_ingestion_sources,
                "hasAnomalyRules": has_anomaly_rules,
                "hasRecentActivity": has_recent_activity,
                "hasApplicationTraces": has_application_traces,
                "governanceActive": governance_active,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        has_personal_v_ks = d.pop("hasPersonalVKs")

        has_routing_policies = d.pop("hasRoutingPolicies")

        has_ingestion_sources = d.pop("hasIngestionSources")

        has_anomaly_rules = d.pop("hasAnomalyRules")

        has_recent_activity = d.pop("hasRecentActivity")

        has_application_traces = d.pop("hasApplicationTraces")

        governance_active = d.pop("governanceActive")

        read_cli_governance_status_response_200_setup = cls(
            has_personal_v_ks=has_personal_v_ks,
            has_routing_policies=has_routing_policies,
            has_ingestion_sources=has_ingestion_sources,
            has_anomaly_rules=has_anomaly_rules,
            has_recent_activity=has_recent_activity,
            has_application_traces=has_application_traces,
            governance_active=governance_active,
        )

        return read_cli_governance_status_response_200_setup
