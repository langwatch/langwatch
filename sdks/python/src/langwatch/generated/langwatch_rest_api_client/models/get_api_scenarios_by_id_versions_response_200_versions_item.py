from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiScenariosByIdVersionsResponse200VersionsItem")


@_attrs_define
class GetApiScenariosByIdVersionsResponse200VersionsItem:
    """
    Attributes:
        version (int): The version number, counting from 1.
        author_label (None | str): Which surface wrote the version: user, api, cli or langy. Null on the synthesized
            Created entry of a case saved before versions were recorded.
        author_id (None | str): The user who saved the version. Null when the save came from an API key.
        change_description (None | str):
        changed_fields (list[str]): The fields whose value this save changed.
        created_at (str): When the version was written, in ISO 8601.
        is_synthesized (bool): True on the Created entry a case saved before versions were recorded shows. It has no
            stored snapshot, so it cannot be read back.
    """

    version: int
    author_label: None | str
    author_id: None | str
    change_description: None | str
    changed_fields: list[str]
    created_at: str
    is_synthesized: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        author_label: None | str
        author_label = self.author_label

        author_id: None | str
        author_id = self.author_id

        change_description: None | str
        change_description = self.change_description

        changed_fields = self.changed_fields

        created_at = self.created_at

        is_synthesized = self.is_synthesized

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "version": version,
                "authorLabel": author_label,
                "authorId": author_id,
                "changeDescription": change_description,
                "changedFields": changed_fields,
                "createdAt": created_at,
                "isSynthesized": is_synthesized,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        version = d.pop("version")

        def _parse_author_label(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        author_label = _parse_author_label(d.pop("authorLabel"))

        def _parse_author_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        author_id = _parse_author_id(d.pop("authorId"))

        def _parse_change_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        change_description = _parse_change_description(d.pop("changeDescription"))

        changed_fields = cast(list[str], d.pop("changedFields"))

        created_at = d.pop("createdAt")

        is_synthesized = d.pop("isSynthesized")

        get_api_scenarios_by_id_versions_response_200_versions_item = cls(
            version=version,
            author_label=author_label,
            author_id=author_id,
            change_description=change_description,
            changed_fields=changed_fields,
            created_at=created_at,
            is_synthesized=is_synthesized,
        )

        get_api_scenarios_by_id_versions_response_200_versions_item.additional_properties = d
        return get_api_scenarios_by_id_versions_response_200_versions_item

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
