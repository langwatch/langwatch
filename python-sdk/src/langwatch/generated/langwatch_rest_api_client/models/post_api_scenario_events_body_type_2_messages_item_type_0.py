from collections.abc import Mapping
from typing import Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType0")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType0:
    """
    Attributes:
        id (str):
        role (Literal['developer']):
        content (str):
        name (Union[Unset, str]):
    """

    id: str
    role: Literal["developer"]
    content: str
    name: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        role = self.role

        content = self.content

        name = self.name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "role": role,
                "content": content,
            }
        )
        if name is not UNSET:
            field_dict["name"] = name

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        role = cast(Literal["developer"], d.pop("role"))
        if role != "developer":
            raise ValueError(f"role must match const 'developer', got '{role}'")

        content = d.pop("content")

        name = d.pop("name", UNSET)

        post_api_scenario_events_body_type_2_messages_item_type_0 = cls(
            id=id,
            role=role,
            content=content,
            name=name,
        )

        post_api_scenario_events_body_type_2_messages_item_type_0.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_0

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
