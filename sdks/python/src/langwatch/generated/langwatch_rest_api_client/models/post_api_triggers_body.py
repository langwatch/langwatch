from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_triggers_body_action import PostApiTriggersBodyAction
from ..models.post_api_triggers_body_alert_type import PostApiTriggersBodyAlertType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_triggers_body_action_params import PostApiTriggersBodyActionParams
    from ..models.post_api_triggers_body_filters import PostApiTriggersBodyFilters


T = TypeVar("T", bound="PostApiTriggersBody")


@_attrs_define
class PostApiTriggersBody:
    """
    Attributes:
        name (str):
        action (PostApiTriggersBodyAction):
        action_params (PostApiTriggersBodyActionParams | Unset):
        filters (PostApiTriggersBodyFilters | Unset):
        message (str | Unset):
        alert_type (PostApiTriggersBodyAlertType | Unset):
    """

    name: str
    action: PostApiTriggersBodyAction
    action_params: PostApiTriggersBodyActionParams | Unset = UNSET
    filters: PostApiTriggersBodyFilters | Unset = UNSET
    message: str | Unset = UNSET
    alert_type: PostApiTriggersBodyAlertType | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        action = self.action.value

        action_params: dict[str, Any] | Unset = UNSET
        if not isinstance(self.action_params, Unset):
            action_params = self.action_params.to_dict()

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        message = self.message

        alert_type: str | Unset = UNSET
        if not isinstance(self.alert_type, Unset):
            alert_type = self.alert_type.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "action": action,
            }
        )
        if action_params is not UNSET:
            field_dict["actionParams"] = action_params
        if filters is not UNSET:
            field_dict["filters"] = filters
        if message is not UNSET:
            field_dict["message"] = message
        if alert_type is not UNSET:
            field_dict["alertType"] = alert_type

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_triggers_body_action_params import PostApiTriggersBodyActionParams
        from ..models.post_api_triggers_body_filters import PostApiTriggersBodyFilters

        d = dict(src_dict)
        name = d.pop("name")

        action = PostApiTriggersBodyAction(d.pop("action"))

        _action_params = d.pop("actionParams", UNSET)
        action_params: PostApiTriggersBodyActionParams | Unset
        if isinstance(_action_params, Unset):
            action_params = UNSET
        else:
            action_params = PostApiTriggersBodyActionParams.from_dict(_action_params)

        _filters = d.pop("filters", UNSET)
        filters: PostApiTriggersBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiTriggersBodyFilters.from_dict(_filters)

        message = d.pop("message", UNSET)

        _alert_type = d.pop("alertType", UNSET)
        alert_type: PostApiTriggersBodyAlertType | Unset
        if isinstance(_alert_type, Unset):
            alert_type = UNSET
        else:
            alert_type = PostApiTriggersBodyAlertType(_alert_type)

        post_api_triggers_body = cls(
            name=name,
            action=action,
            action_params=action_params,
            filters=filters,
            message=message,
            alert_type=alert_type,
        )

        post_api_triggers_body.additional_properties = d
        return post_api_triggers_body

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
