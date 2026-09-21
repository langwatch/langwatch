from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiGatewayV1BudgetsBodyScopeType5")


@_attrs_define
class PostApiGatewayV1BudgetsBodyScopeType5:
    """
    Attributes:
        kind (Literal['group']):
        group_id (str):
    """

    kind: Literal["group"]
    group_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        group_id = self.group_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
                "group_id": group_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["group"], d.pop("kind"))
        if kind != "group":
            raise ValueError(f"kind must match const 'group', got '{kind}'")

        group_id = d.pop("group_id")

        post_api_gateway_v1_budgets_body_scope_type_5 = cls(
            kind=kind,
            group_id=group_id,
        )

        post_api_gateway_v1_budgets_body_scope_type_5.additional_properties = d
        return post_api_gateway_v1_budgets_body_scope_type_5

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
