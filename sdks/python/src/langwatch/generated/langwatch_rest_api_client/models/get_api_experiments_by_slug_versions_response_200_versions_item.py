from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiExperimentsBySlugVersionsResponse200VersionsItem")


@_attrs_define
class GetApiExperimentsBySlugVersionsResponse200VersionsItem:
    """
    Attributes:
        version (int): Restore this version by this number. Named versions run 1, 2, 3 with no gaps. The autosave row
            also has a number, but it changes with every save, so read it as a handle and not as a place in the history.
        counter_version (int): The setup version this row was written at. It says how recent the row is, and it equals
            the experiment's current version on the row holding the live setup.
        auto_saved (bool): True for the single autosave row, which every ordinary save rewrites in place
        commit_message (None | str):
        author_label (str): Who wrote it: user, langy or api Example: user.
        author_id (None | str): User id, when a person wrote it
        created_at (str): ISO 8601 timestamp of the first write
        updated_at (str): ISO 8601 timestamp of the last write. The autosave row is rewritten in place, so this is what
            says how old its content is.
    """

    version: int
    counter_version: int
    auto_saved: bool
    commit_message: None | str
    author_label: str
    author_id: None | str
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        counter_version = self.counter_version

        auto_saved = self.auto_saved

        commit_message: None | str
        commit_message = self.commit_message

        author_label = self.author_label

        author_id: None | str
        author_id = self.author_id

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "version": version,
                "counterVersion": counter_version,
                "autoSaved": auto_saved,
                "commitMessage": commit_message,
                "authorLabel": author_label,
                "authorId": author_id,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        version = d.pop("version")

        counter_version = d.pop("counterVersion")

        auto_saved = d.pop("autoSaved")

        def _parse_commit_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        commit_message = _parse_commit_message(d.pop("commitMessage"))

        author_label = d.pop("authorLabel")

        def _parse_author_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        author_id = _parse_author_id(d.pop("authorId"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        get_api_experiments_by_slug_versions_response_200_versions_item = cls(
            version=version,
            counter_version=counter_version,
            auto_saved=auto_saved,
            commit_message=commit_message,
            author_label=author_label,
            author_id=author_id,
            created_at=created_at,
            updated_at=updated_at,
        )

        get_api_experiments_by_slug_versions_response_200_versions_item.additional_properties = d
        return get_api_experiments_by_slug_versions_response_200_versions_item

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
