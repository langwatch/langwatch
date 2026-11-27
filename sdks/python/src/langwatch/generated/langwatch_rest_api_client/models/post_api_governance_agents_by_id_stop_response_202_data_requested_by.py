from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiGovernanceAgentsByIdStopResponse202DataRequestedBy")


@_attrs_define
class PostApiGovernanceAgentsByIdStopResponse202DataRequestedBy:
    """
    Attributes:
        user_id (None | str):
        api_key_id (None | str):
    """

    user_id: None | str
    api_key_id: None | str

    def to_dict(self) -> dict[str, Any]:
        user_id: None | str
        user_id = self.user_id

        api_key_id: None | str
        api_key_id = self.api_key_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "userId": user_id,
                "apiKeyId": api_key_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_id = _parse_user_id(d.pop("userId"))

        def _parse_api_key_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        api_key_id = _parse_api_key_id(d.pop("apiKeyId"))

        post_api_governance_agents_by_id_stop_response_202_data_requested_by = cls(
            user_id=user_id,
            api_key_id=api_key_id,
        )

        return post_api_governance_agents_by_id_stop_response_202_data_requested_by
