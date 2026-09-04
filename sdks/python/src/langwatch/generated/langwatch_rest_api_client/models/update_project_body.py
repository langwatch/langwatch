from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="UpdateProjectBody")


@_attrs_define
class UpdateProjectBody:
    """
    Attributes:
        name (str | Unset):
        language (str | Unset):
        framework (str | Unset):
        team_id (str | Unset): Moves the project to this team
    """

    name: str | Unset = UNSET
    language: str | Unset = UNSET
    framework: str | Unset = UNSET
    team_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        language = self.language

        framework = self.framework

        team_id = self.team_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if language is not UNSET:
            field_dict["language"] = language
        if framework is not UNSET:
            field_dict["framework"] = framework
        if team_id is not UNSET:
            field_dict["teamId"] = team_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        language = d.pop("language", UNSET)

        framework = d.pop("framework", UNSET)

        team_id = d.pop("teamId", UNSET)

        update_project_body = cls(
            name=name,
            language=language,
            framework=framework,
            team_id=team_id,
        )

        update_project_body.additional_properties = d
        return update_project_body

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
