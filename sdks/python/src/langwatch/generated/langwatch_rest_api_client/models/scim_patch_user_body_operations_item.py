from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.scim_patch_user_body_operations_item_op import ScimPatchUserBodyOperationsItemOp
from ..types import UNSET, Unset

T = TypeVar("T", bound="ScimPatchUserBodyOperationsItem")


@_attrs_define
class ScimPatchUserBodyOperationsItem:
    """
    Attributes:
        op (ScimPatchUserBodyOperationsItemOp):
        path (str | Unset):
        value (Any | Unset):
    """

    op: ScimPatchUserBodyOperationsItemOp
    path: str | Unset = UNSET
    value: Any | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        op = self.op.value

        path = self.path

        value = self.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "op": op,
            }
        )
        if path is not UNSET:
            field_dict["path"] = path
        if value is not UNSET:
            field_dict["value"] = value

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        op = ScimPatchUserBodyOperationsItemOp(d.pop("op"))

        path = d.pop("path", UNSET)

        value = d.pop("value", UNSET)

        scim_patch_user_body_operations_item = cls(
            op=op,
            path=path,
            value=value,
        )

        scim_patch_user_body_operations_item.additional_properties = d
        return scim_patch_user_body_operations_item

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
