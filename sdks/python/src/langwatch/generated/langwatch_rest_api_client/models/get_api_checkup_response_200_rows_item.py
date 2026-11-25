from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_checkup_response_200_rows_item_cost import GetApiCheckupResponse200RowsItemCost
from ..models.get_api_checkup_response_200_rows_item_group import GetApiCheckupResponse200RowsItemGroup
from ..models.get_api_checkup_response_200_rows_item_id import GetApiCheckupResponse200RowsItemId

if TYPE_CHECKING:
    from ..models.get_api_checkup_response_200_rows_item_verdict_type_0 import (
        GetApiCheckupResponse200RowsItemVerdictType0,
    )
    from ..models.get_api_checkup_response_200_rows_item_verdict_type_1 import (
        GetApiCheckupResponse200RowsItemVerdictType1,
    )
    from ..models.get_api_checkup_response_200_rows_item_verdict_type_2 import (
        GetApiCheckupResponse200RowsItemVerdictType2,
    )


T = TypeVar("T", bound="GetApiCheckupResponse200RowsItem")


@_attrs_define
class GetApiCheckupResponse200RowsItem:
    """
    Attributes:
        id (GetApiCheckupResponse200RowsItemId):
        name (str):
        group (GetApiCheckupResponse200RowsItemGroup):
        cost (GetApiCheckupResponse200RowsItemCost):
        verdict (GetApiCheckupResponse200RowsItemVerdictType0 | GetApiCheckupResponse200RowsItemVerdictType1 |
            GetApiCheckupResponse200RowsItemVerdictType2):
    """

    id: GetApiCheckupResponse200RowsItemId
    name: str
    group: GetApiCheckupResponse200RowsItemGroup
    cost: GetApiCheckupResponse200RowsItemCost
    verdict: (
        GetApiCheckupResponse200RowsItemVerdictType0
        | GetApiCheckupResponse200RowsItemVerdictType1
        | GetApiCheckupResponse200RowsItemVerdictType2
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_checkup_response_200_rows_item_verdict_type_0 import (
            GetApiCheckupResponse200RowsItemVerdictType0,
        )
        from ..models.get_api_checkup_response_200_rows_item_verdict_type_1 import (
            GetApiCheckupResponse200RowsItemVerdictType1,
        )

        id = self.id.value

        name = self.name

        group = self.group.value

        cost = self.cost.value

        verdict: dict[str, Any]
        if isinstance(self.verdict, GetApiCheckupResponse200RowsItemVerdictType0):
            verdict = self.verdict.to_dict()
        elif isinstance(self.verdict, GetApiCheckupResponse200RowsItemVerdictType1):
            verdict = self.verdict.to_dict()
        else:
            verdict = self.verdict.to_dict()

        field_dict: dict[str, Any] = {}

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
        from ..models.get_api_checkup_response_200_rows_item_verdict_type_0 import (
            GetApiCheckupResponse200RowsItemVerdictType0,
        )
        from ..models.get_api_checkup_response_200_rows_item_verdict_type_1 import (
            GetApiCheckupResponse200RowsItemVerdictType1,
        )
        from ..models.get_api_checkup_response_200_rows_item_verdict_type_2 import (
            GetApiCheckupResponse200RowsItemVerdictType2,
        )

        d = dict(src_dict)
        id = GetApiCheckupResponse200RowsItemId(d.pop("id"))

        name = d.pop("name")

        group = GetApiCheckupResponse200RowsItemGroup(d.pop("group"))

        cost = GetApiCheckupResponse200RowsItemCost(d.pop("cost"))

        def _parse_verdict(
            data: object,
        ) -> (
            GetApiCheckupResponse200RowsItemVerdictType0
            | GetApiCheckupResponse200RowsItemVerdictType1
            | GetApiCheckupResponse200RowsItemVerdictType2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                verdict_type_0 = GetApiCheckupResponse200RowsItemVerdictType0.from_dict(data)

                return verdict_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                verdict_type_1 = GetApiCheckupResponse200RowsItemVerdictType1.from_dict(data)

                return verdict_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            verdict_type_2 = GetApiCheckupResponse200RowsItemVerdictType2.from_dict(data)

            return verdict_type_2

        verdict = _parse_verdict(d.pop("verdict"))

        get_api_checkup_response_200_rows_item = cls(
            id=id,
            name=name,
            group=group,
            cost=cost,
            verdict=verdict,
        )

        return get_api_checkup_response_200_rows_item
