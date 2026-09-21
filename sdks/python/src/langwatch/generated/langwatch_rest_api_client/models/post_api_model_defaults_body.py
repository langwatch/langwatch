from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_model_defaults_body_config import PostApiModelDefaultsBodyConfig
    from ..models.post_api_model_defaults_body_scopes_item import PostApiModelDefaultsBodyScopesItem


T = TypeVar("T", bound="PostApiModelDefaultsBody")


@_attrs_define
class PostApiModelDefaultsBody:
    """
    Attributes:
        config (PostApiModelDefaultsBodyConfig):
        scopes (list[PostApiModelDefaultsBodyScopesItem]):
    """

    config: PostApiModelDefaultsBodyConfig
    scopes: list[PostApiModelDefaultsBodyScopesItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        config = self.config.to_dict()

        scopes = []
        for scopes_item_data in self.scopes:
            scopes_item = scopes_item_data.to_dict()
            scopes.append(scopes_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "config": config,
                "scopes": scopes,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_model_defaults_body_config import PostApiModelDefaultsBodyConfig
        from ..models.post_api_model_defaults_body_scopes_item import PostApiModelDefaultsBodyScopesItem

        d = dict(src_dict)
        config = PostApiModelDefaultsBodyConfig.from_dict(d.pop("config"))

        scopes = []
        _scopes = d.pop("scopes")
        for scopes_item_data in _scopes:
            scopes_item = PostApiModelDefaultsBodyScopesItem.from_dict(scopes_item_data)

            scopes.append(scopes_item)

        post_api_model_defaults_body = cls(
            config=config,
            scopes=scopes,
        )

        post_api_model_defaults_body.additional_properties = d
        return post_api_model_defaults_body

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
