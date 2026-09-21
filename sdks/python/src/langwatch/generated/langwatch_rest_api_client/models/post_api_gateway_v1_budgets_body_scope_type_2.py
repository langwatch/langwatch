from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiGatewayV1BudgetsBodyScopeType2")


@_attrs_define
class PostApiGatewayV1BudgetsBodyScopeType2:
    """
    Attributes:
        kind (Literal['project']):
        project_id (str):
    """

    kind: Literal["project"]
    project_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        project_id = self.project_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
                "project_id": project_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["project"], d.pop("kind"))
        if kind != "project":
            raise ValueError(f"kind must match const 'project', got '{kind}'")

        project_id = d.pop("project_id")

        post_api_gateway_v1_budgets_body_scope_type_2 = cls(
            kind=kind,
            project_id=project_id,
        )

        post_api_gateway_v1_budgets_body_scope_type_2.additional_properties = d
        return post_api_gateway_v1_budgets_body_scope_type_2

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
