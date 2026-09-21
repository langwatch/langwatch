from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGatewayV1BudgetsBodyScopeType6")


@_attrs_define
class PostApiGatewayV1BudgetsBodyScopeType6:
    """
    Attributes:
        kind (Literal['attributed_user']):
        anchor_virtual_key_id (str | Unset):
        anchor_project_id (str | Unset):
    """

    kind: Literal["attributed_user"]
    anchor_virtual_key_id: str | Unset = UNSET
    anchor_project_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        anchor_virtual_key_id = self.anchor_virtual_key_id

        anchor_project_id = self.anchor_project_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
            }
        )
        if anchor_virtual_key_id is not UNSET:
            field_dict["anchor_virtual_key_id"] = anchor_virtual_key_id
        if anchor_project_id is not UNSET:
            field_dict["anchor_project_id"] = anchor_project_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["attributed_user"], d.pop("kind"))
        if kind != "attributed_user":
            raise ValueError(f"kind must match const 'attributed_user', got '{kind}'")

        anchor_virtual_key_id = d.pop("anchor_virtual_key_id", UNSET)

        anchor_project_id = d.pop("anchor_project_id", UNSET)

        post_api_gateway_v1_budgets_body_scope_type_6 = cls(
            kind=kind,
            anchor_virtual_key_id=anchor_virtual_key_id,
            anchor_project_id=anchor_project_id,
        )

        post_api_gateway_v1_budgets_body_scope_type_6.additional_properties = d
        return post_api_gateway_v1_budgets_body_scope_type_6

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
