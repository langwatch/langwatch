from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PatchApiSuitesByIdResponse200ScopeType0Type1")


@_attrs_define
class PatchApiSuitesByIdResponse200ScopeType0Type1:
    """
    Attributes:
        mode (Literal['folders']):
        folder_ids (list[str]):
    """

    mode: Literal["folders"]
    folder_ids: list[str]

    def to_dict(self) -> dict[str, Any]:
        mode = self.mode

        folder_ids = self.folder_ids

        field_dict: dict[str, Any] = {}

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

        patch_api_suites_by_id_response_200_scope_type_0_type_1 = cls(
            mode=mode,
            folder_ids=folder_ids,
        )

        return patch_api_suites_by_id_response_200_scope_type_0_type_1
