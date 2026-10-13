from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_cli_ingestion_keys_response_200_keys_item import ListCliIngestionKeysResponse200KeysItem


T = TypeVar("T", bound="ListCliIngestionKeysResponse200")


@_attrs_define
class ListCliIngestionKeysResponse200:
    """
    Attributes:
        keys (list[ListCliIngestionKeysResponse200KeysItem]):
    """

    keys: list[ListCliIngestionKeysResponse200KeysItem]

    def to_dict(self) -> dict[str, Any]:
        keys = []
        for keys_item_data in self.keys:
            keys_item = keys_item_data.to_dict()
            keys.append(keys_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "keys": keys,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_cli_ingestion_keys_response_200_keys_item import ListCliIngestionKeysResponse200KeysItem

        d = dict(src_dict)
        keys = []
        _keys = d.pop("keys")
        for keys_item_data in _keys:
            keys_item = ListCliIngestionKeysResponse200KeysItem.from_dict(keys_item_data)

            keys.append(keys_item)

        list_cli_ingestion_keys_response_200 = cls(
            keys=keys,
        )

        return list_cli_ingestion_keys_response_200
