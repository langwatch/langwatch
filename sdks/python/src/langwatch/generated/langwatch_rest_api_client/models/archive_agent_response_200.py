from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.archive_agent_response_200_type import ArchiveAgentResponse200Type

T = TypeVar("T", bound="ArchiveAgentResponse200")


@_attrs_define
class ArchiveAgentResponse200:
    """
    Attributes:
        id (str):
        name (str):
        type_ (ArchiveAgentResponse200Type):
        archived_at (None | str):
    """

    id: str
    name: str
    type_: ArchiveAgentResponse200Type
    archived_at: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        type_ = self.type_.value

        archived_at: None | str
        archived_at = self.archived_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "type": type_,
                "archivedAt": archived_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        type_ = ArchiveAgentResponse200Type(d.pop("type"))

        def _parse_archived_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        archived_at = _parse_archived_at(d.pop("archivedAt"))

        archive_agent_response_200 = cls(
            id=id,
            name=name,
            type_=type_,
            archived_at=archived_at,
        )

        archive_agent_response_200.additional_properties = d
        return archive_agent_response_200

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
