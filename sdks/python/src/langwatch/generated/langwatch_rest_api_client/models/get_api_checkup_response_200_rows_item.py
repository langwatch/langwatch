from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_checkup_response_200_rows_item_cost import GetApiCheckupResponse200RowsItemCost
from ..models.get_api_checkup_response_200_rows_item_group import GetApiCheckupResponse200RowsItemGroup

if TYPE_CHECKING:
    from ..models.get_api_checkup_response_200_rows_item_verdict import GetApiCheckupResponse200RowsItemVerdict


T = TypeVar("T", bound="GetApiCheckupResponse200RowsItem")


@_attrs_define
class GetApiCheckupResponse200RowsItem:
    """
    Attributes:
        id (str): The check, one of the ids `POST /api/checkup/run` accepts.
        name (str):
        group (GetApiCheckupResponse200RowsItemGroup):
        cost (GetApiCheckupResponse200RowsItemCost): Free checks run on every call; egress and paid ones only through
            `POST /api/checkup/run`.
        verdict (GetApiCheckupResponse200RowsItemVerdict):
    """

    id: str
    name: str
    group: GetApiCheckupResponse200RowsItemGroup
    cost: GetApiCheckupResponse200RowsItemCost
    verdict: GetApiCheckupResponse200RowsItemVerdict
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        group = self.group.value

        cost = self.cost.value

        verdict = self.verdict.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "group": group,
                "cost": cost,
                "verdict": verdict,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_checkup_response_200_rows_item_verdict import GetApiCheckupResponse200RowsItemVerdict

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        group = GetApiCheckupResponse200RowsItemGroup(d.pop("group"))

        cost = GetApiCheckupResponse200RowsItemCost(d.pop("cost"))

        verdict = GetApiCheckupResponse200RowsItemVerdict.from_dict(d.pop("verdict"))

        get_api_checkup_response_200_rows_item = cls(
            id=id,
            name=name,
            group=group,
            cost=cost,
            verdict=verdict,
        )

        get_api_checkup_response_200_rows_item.additional_properties = d
        return get_api_checkup_response_200_rows_item

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
