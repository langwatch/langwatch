from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiModelDefaultsResponse200Scope")


@_attrs_define
class GetApiModelDefaultsResponse200Scope:
    """
    Attributes:
        project_id (str):
        team_id (None | str):
        organization_id (None | str):
        organization_name (None | str):
    """

    project_id: str
    team_id: None | str
    organization_id: None | str
    organization_name: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        project_id = self.project_id

        team_id: None | str
        team_id = self.team_id

        organization_id: None | str
        organization_id = self.organization_id

        organization_name: None | str
        organization_name = self.organization_name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "projectId": project_id,
                "teamId": team_id,
                "organizationId": organization_id,
                "organizationName": organization_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        project_id = d.pop("projectId")

        def _parse_team_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        team_id = _parse_team_id(d.pop("teamId"))

        def _parse_organization_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        organization_id = _parse_organization_id(d.pop("organizationId"))

        def _parse_organization_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        organization_name = _parse_organization_name(d.pop("organizationName"))

        get_api_model_defaults_response_200_scope = cls(
            project_id=project_id,
            team_id=team_id,
            organization_id=organization_id,
            organization_name=organization_name,
        )

        get_api_model_defaults_response_200_scope.additional_properties = d
        return get_api_model_defaults_response_200_scope

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
