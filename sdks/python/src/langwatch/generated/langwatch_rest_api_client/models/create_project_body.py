from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateProjectBody")


@_attrs_define
class CreateProjectBody:
    """
    Attributes:
        name (str): Project name
        language (str): Programming language (e.g. python, typescript)
        framework (str): Framework (e.g. langchain, vercel-ai, openai)
        team_id (str | Unset): ID of an existing team to assign the project to
        new_team_name (str | Unset): Name for a new team to create and assign the project to
    """

    name: str
    language: str
    framework: str
    team_id: str | Unset = UNSET
    new_team_name: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        language = self.language

        framework = self.framework

        team_id = self.team_id

        new_team_name = self.new_team_name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "language": language,
                "framework": framework,
            }
        )
        if team_id is not UNSET:
            field_dict["teamId"] = team_id
        if new_team_name is not UNSET:
            field_dict["newTeamName"] = new_team_name

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        language = d.pop("language")

        framework = d.pop("framework")

        team_id = d.pop("teamId", UNSET)

        new_team_name = d.pop("newTeamName", UNSET)

        create_project_body = cls(
            name=name,
            language=language,
            framework=framework,
            team_id=team_id,
            new_team_name=new_team_name,
        )

        create_project_body.additional_properties = d
        return create_project_body

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
