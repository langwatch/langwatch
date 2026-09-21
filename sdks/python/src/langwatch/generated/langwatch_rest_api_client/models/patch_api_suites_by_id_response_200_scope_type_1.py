from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PatchApiSuitesByIdResponse200ScopeType1")


@_attrs_define
class PatchApiSuitesByIdResponse200ScopeType1:
    """
    Attributes:
        mode (Literal['folders']):
        folder_ids (list[str]):
    """

    mode: Literal["folders"]
    folder_ids: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        mode = self.mode

        folder_ids = self.folder_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "mode": mode,
                "folderIds": folder_ids,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        mode = cast(Literal["folders"], d.pop("mode"))
        if mode != "folders":
            raise ValueError(f"mode must match const 'folders', got '{mode}'")

        folder_ids = cast(list[str], d.pop("folderIds"))

        patch_api_suites_by_id_response_200_scope_type_1 = cls(
            mode=mode,
            folder_ids=folder_ids,
        )

        patch_api_suites_by_id_response_200_scope_type_1.additional_properties = d
        return patch_api_suites_by_id_response_200_scope_type_1

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
