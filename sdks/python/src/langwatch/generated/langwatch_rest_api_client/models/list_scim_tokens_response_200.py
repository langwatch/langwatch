from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_scim_tokens_response_200_tokens_item import ListScimTokensResponse200TokensItem


T = TypeVar("T", bound="ListScimTokensResponse200")


@_attrs_define
class ListScimTokensResponse200:
    """
    Attributes:
        tokens (list[ListScimTokensResponse200TokensItem]):
    """

    tokens: list[ListScimTokensResponse200TokensItem]

    def to_dict(self) -> dict[str, Any]:
        tokens = []
        for tokens_item_data in self.tokens:
            tokens_item = tokens_item_data.to_dict()
            tokens.append(tokens_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "tokens": tokens,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_scim_tokens_response_200_tokens_item import ListScimTokensResponse200TokensItem

        d = dict(src_dict)
        tokens = []
        _tokens = d.pop("tokens")
        for tokens_item_data in _tokens:
            tokens_item = ListScimTokensResponse200TokensItem.from_dict(tokens_item_data)

            tokens.append(tokens_item)

        list_scim_tokens_response_200 = cls(
            tokens=tokens,
        )

        return list_scim_tokens_response_200
