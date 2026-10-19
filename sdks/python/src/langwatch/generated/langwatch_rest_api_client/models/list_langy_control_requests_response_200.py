from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_langy_control_requests_response_200_requests_item import (
        ListLangyControlRequestsResponse200RequestsItem,
    )


T = TypeVar("T", bound="ListLangyControlRequestsResponse200")


@_attrs_define
class ListLangyControlRequestsResponse200:
    """
    Attributes:
        requests (list[ListLangyControlRequestsResponse200RequestsItem]):
    """

    requests: list[ListLangyControlRequestsResponse200RequestsItem]

    def to_dict(self) -> dict[str, Any]:
        requests = []
        for requests_item_data in self.requests:
            requests_item = requests_item_data.to_dict()
            requests.append(requests_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "requests": requests,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_langy_control_requests_response_200_requests_item import (
            ListLangyControlRequestsResponse200RequestsItem,
        )

        d = dict(src_dict)
        requests = []
        _requests = d.pop("requests")
        for requests_item_data in _requests:
            requests_item = ListLangyControlRequestsResponse200RequestsItem.from_dict(requests_item_data)

            requests.append(requests_item)

        list_langy_control_requests_response_200 = cls(
            requests=requests,
        )

        return list_langy_control_requests_response_200
