from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.scim_patch_user_body_operations_item import ScimPatchUserBodyOperationsItem


T = TypeVar("T", bound="ScimPatchUserBody")


@_attrs_define
class ScimPatchUserBody:
    """
    Attributes:
        schemas (list[str]):
        operations (list[ScimPatchUserBodyOperationsItem]):
    """

    schemas: list[str]
    operations: list[ScimPatchUserBodyOperationsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schemas = self.schemas

        operations = []
        for operations_item_data in self.operations:
            operations_item = operations_item_data.to_dict()
            operations.append(operations_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "schemas": schemas,
                "Operations": operations,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_patch_user_body_operations_item import ScimPatchUserBodyOperationsItem

        d = dict(src_dict)
        schemas = cast(list[str], d.pop("schemas"))

        operations = []
        _operations = d.pop("Operations")
        for operations_item_data in _operations:
            operations_item = ScimPatchUserBodyOperationsItem.from_dict(operations_item_data)

            operations.append(operations_item)

        scim_patch_user_body = cls(
            schemas=schemas,
            operations=operations,
        )

        scim_patch_user_body.additional_properties = d
        return scim_patch_user_body

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
