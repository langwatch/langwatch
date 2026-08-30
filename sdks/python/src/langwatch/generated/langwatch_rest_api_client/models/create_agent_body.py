from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_agent_body_type import CreateAgentBodyType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_config import CreateAgentBodyConfig


T = TypeVar("T", bound="CreateAgentBody")


@_attrs_define
class CreateAgentBody:
    """
    Attributes:
        name (str):
        type_ (CreateAgentBodyType): The kind of agent to write. A connected agent is registered from code by the SDK,
            so "connected" is refused with agent_register_only.
        config (CreateAgentBodyConfig):
        workflow_id (str | Unset):
    """

    name: str
    type_: CreateAgentBodyType
    config: CreateAgentBodyConfig
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
        from ..models.create_agent_body_config import CreateAgentBodyConfig

        d = dict(src_dict)
        name = d.pop("name")

        type_ = CreateAgentBodyType(d.pop("type"))

        config = CreateAgentBodyConfig.from_dict(d.pop("config"))

        workflow_id = d.pop("workflowId", UNSET)

        create_agent_body = cls(
            name=name,
            type_=type_,
            config=config,
            workflow_id=workflow_id,
        )

        create_agent_body.additional_properties = d
        return create_agent_body

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
