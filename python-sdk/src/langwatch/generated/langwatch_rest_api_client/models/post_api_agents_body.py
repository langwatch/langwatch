from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_agents_body_type import PostApiAgentsBodyType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_agents_body_config import PostApiAgentsBodyConfig


T = TypeVar("T", bound="PostApiAgentsBody")


@_attrs_define
class PostApiAgentsBody:
    """
    Attributes:
        name (str):
        type_ (PostApiAgentsBodyType):
        config (PostApiAgentsBodyConfig):
        workflow_id (str | Unset):
    """

    name: str
    type_: PostApiAgentsBodyType
    config: PostApiAgentsBodyConfig
    workflow_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        config = self.config.to_dict()

        workflow_id = self.workflow_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "type": type_,
                "config": config,
            }
        )
        if workflow_id is not UNSET:
            field_dict["workflowId"] = workflow_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_agents_body_config import PostApiAgentsBodyConfig

        d = dict(src_dict)
        name = d.pop("name")

        type_ = PostApiAgentsBodyType(d.pop("type"))

        config = PostApiAgentsBodyConfig.from_dict(d.pop("config"))

        workflow_id = d.pop("workflowId", UNSET)

        post_api_agents_body = cls(
            name=name,
            type_=type_,
            config=config,
            workflow_id=workflow_id,
        )

        post_api_agents_body.additional_properties = d
        return post_api_agents_body

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
