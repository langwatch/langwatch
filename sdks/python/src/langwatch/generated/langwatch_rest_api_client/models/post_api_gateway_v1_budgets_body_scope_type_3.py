from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiGatewayV1BudgetsBodyScopeType3")


@_attrs_define
class PostApiGatewayV1BudgetsBodyScopeType3:
    """
    Attributes:
        kind (Literal['virtual_key']):
        virtual_key_id (str):
    """

    kind: Literal["virtual_key"]
    virtual_key_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        virtual_key_id = self.virtual_key_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
                "virtual_key_id": virtual_key_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["virtual_key"], d.pop("kind"))
        if kind != "virtual_key":
            raise ValueError(f"kind must match const 'virtual_key', got '{kind}'")

        virtual_key_id = d.pop("virtual_key_id")

        post_api_gateway_v1_budgets_body_scope_type_3 = cls(
            kind=kind,
            virtual_key_id=virtual_key_id,
        )

        post_api_gateway_v1_budgets_body_scope_type_3.additional_properties = d
        return post_api_gateway_v1_budgets_body_scope_type_3

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
