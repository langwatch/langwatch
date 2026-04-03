from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_dataset_body_column_types_item import PostApiDatasetBodyColumnTypesItem


T = TypeVar("T", bound="PostApiDatasetBody")


@_attrs_define
class PostApiDatasetBody:
    """
    Attributes:
        name (str):
        column_types (Union[Unset, list['PostApiDatasetBodyColumnTypesItem']]):
    """

    name: str
    column_types: Union[Unset, list["PostApiDatasetBodyColumnTypesItem"]] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        column_types: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.column_types, Unset):
            column_types = []
            for column_types_item_data in self.column_types:
                column_types_item = column_types_item_data.to_dict()
                column_types.append(column_types_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
            }
        )
        if column_types is not UNSET:
            field_dict["columnTypes"] = column_types

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dataset_body_column_types_item import PostApiDatasetBodyColumnTypesItem

        d = dict(src_dict)
        name = d.pop("name")

        column_types = []
        _column_types = d.pop("columnTypes", UNSET)
        for column_types_item_data in _column_types or []:
            column_types_item = PostApiDatasetBodyColumnTypesItem.from_dict(column_types_item_data)

            column_types.append(column_types_item)

        post_api_dataset_body = cls(
            name=name,
            column_types=column_types,
        )

        post_api_dataset_body.additional_properties = d
        return post_api_dataset_body

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
