from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiTriggersByIdDisableResponse200ActionParams")


@_attrs_define
class PostApiTriggersByIdDisableResponse200ActionParams:
    """Where this automation delivers, with every credential value replaced by the `[redacted]` placeholder. Which channel
    is configured, which destination is set and which header names are in play all survive; the values never leave; a
    Slack automation names its connection by `slackIntegrationId` and carries no secret. Sending the placeholder back on
    an update keeps the stored value. The rule this automation fires by is not here — it is stated in `graphAlert` or
    `report`, and sending it in this field is refused.

    """

    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        post_api_triggers_by_id_disable_response_200_action_params = cls()

        post_api_triggers_by_id_disable_response_200_action_params.additional_properties = d
        return post_api_triggers_by_id_disable_response_200_action_params

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
