from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiGatewayV1BudgetsBodyScopeType4")


@_attrs_define
class PostApiGatewayV1BudgetsBodyScopeType4:
    """
    Attributes:
        kind (Literal['principal']):
        principal_user_id (str):
    """

    kind: Literal["principal"]
    principal_user_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        principal_user_id = self.principal_user_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
                "principal_user_id": principal_user_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["principal"], d.pop("kind"))
        if kind != "principal":
            raise ValueError(f"kind must match const 'principal', got '{kind}'")

        principal_user_id = d.pop("principal_user_id")

        post_api_gateway_v1_budgets_body_scope_type_4 = cls(
            kind=kind,
            principal_user_id=principal_user_id,
        )

        post_api_gateway_v1_budgets_body_scope_type_4.additional_properties = d
        return post_api_gateway_v1_budgets_body_scope_type_4

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
