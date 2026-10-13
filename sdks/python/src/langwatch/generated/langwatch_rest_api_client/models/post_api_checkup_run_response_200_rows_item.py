from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_checkup_run_response_200_rows_item_cost import PostApiCheckupRunResponse200RowsItemCost
from ..models.post_api_checkup_run_response_200_rows_item_group import PostApiCheckupRunResponse200RowsItemGroup
from ..models.post_api_checkup_run_response_200_rows_item_id import PostApiCheckupRunResponse200RowsItemId

if TYPE_CHECKING:
    from ..models.post_api_checkup_run_response_200_rows_item_verdict_type_0 import (
        PostApiCheckupRunResponse200RowsItemVerdictType0,
    )
    from ..models.post_api_checkup_run_response_200_rows_item_verdict_type_1 import (
        PostApiCheckupRunResponse200RowsItemVerdictType1,
    )
    from ..models.post_api_checkup_run_response_200_rows_item_verdict_type_2 import (
        PostApiCheckupRunResponse200RowsItemVerdictType2,
    )


T = TypeVar("T", bound="PostApiCheckupRunResponse200RowsItem")


@_attrs_define
class PostApiCheckupRunResponse200RowsItem:
    """
    Attributes:
        id (PostApiCheckupRunResponse200RowsItemId):
        name (str):
        group (PostApiCheckupRunResponse200RowsItemGroup):
        cost (PostApiCheckupRunResponse200RowsItemCost):
        verdict (PostApiCheckupRunResponse200RowsItemVerdictType0 | PostApiCheckupRunResponse200RowsItemVerdictType1 |
            PostApiCheckupRunResponse200RowsItemVerdictType2):
    """

    id: PostApiCheckupRunResponse200RowsItemId
    name: str
    group: PostApiCheckupRunResponse200RowsItemGroup
    cost: PostApiCheckupRunResponse200RowsItemCost
    verdict: (
        PostApiCheckupRunResponse200RowsItemVerdictType0
        | PostApiCheckupRunResponse200RowsItemVerdictType1
        | PostApiCheckupRunResponse200RowsItemVerdictType2
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_checkup_run_response_200_rows_item_verdict_type_0 import (
            PostApiCheckupRunResponse200RowsItemVerdictType0,
        )
        from ..models.post_api_checkup_run_response_200_rows_item_verdict_type_1 import (
            PostApiCheckupRunResponse200RowsItemVerdictType1,
        )

        id = self.id.value

        name = self.name

        group = self.group.value

        cost = self.cost.value

        verdict: dict[str, Any]
        if isinstance(self.verdict, PostApiCheckupRunResponse200RowsItemVerdictType0):
            verdict = self.verdict.to_dict()
        elif isinstance(self.verdict, PostApiCheckupRunResponse200RowsItemVerdictType1):
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
        from ..models.post_api_checkup_run_response_200_rows_item_verdict_type_0 import (
            PostApiCheckupRunResponse200RowsItemVerdictType0,
        )
        from ..models.post_api_checkup_run_response_200_rows_item_verdict_type_1 import (
            PostApiCheckupRunResponse200RowsItemVerdictType1,
        )
        from ..models.post_api_checkup_run_response_200_rows_item_verdict_type_2 import (
            PostApiCheckupRunResponse200RowsItemVerdictType2,
        )

        d = dict(src_dict)
        id = PostApiCheckupRunResponse200RowsItemId(d.pop("id"))

        name = d.pop("name")

        group = PostApiCheckupRunResponse200RowsItemGroup(d.pop("group"))

        cost = PostApiCheckupRunResponse200RowsItemCost(d.pop("cost"))

        def _parse_verdict(
            data: object,
        ) -> (
            PostApiCheckupRunResponse200RowsItemVerdictType0
            | PostApiCheckupRunResponse200RowsItemVerdictType1
            | PostApiCheckupRunResponse200RowsItemVerdictType2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                verdict_type_0 = PostApiCheckupRunResponse200RowsItemVerdictType0.from_dict(data)

                return verdict_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                verdict_type_1 = PostApiCheckupRunResponse200RowsItemVerdictType1.from_dict(data)

                return verdict_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            verdict_type_2 = PostApiCheckupRunResponse200RowsItemVerdictType2.from_dict(data)

            return verdict_type_2

        verdict = _parse_verdict(d.pop("verdict"))

        post_api_checkup_run_response_200_rows_item = cls(
            id=id,
            name=name,
            group=group,
            cost=cost,
            verdict=verdict,
        )

        return post_api_checkup_run_response_200_rows_item
