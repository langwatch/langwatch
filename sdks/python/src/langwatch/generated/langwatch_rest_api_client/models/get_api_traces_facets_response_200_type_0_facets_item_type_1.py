from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_1_group import (
    GetApiTracesFacetsResponse200Type0FacetsItemType1Group,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_1_discrete import (
        GetApiTracesFacetsResponse200Type0FacetsItemType1Discrete,
    )


T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0FacetsItemType1")


@_attrs_define
class GetApiTracesFacetsResponse200Type0FacetsItemType1:
    """
    Attributes:
        key (str):
        kind (Literal['range']):
        label (str):
        group (GetApiTracesFacetsResponse200Type0FacetsItemType1Group):
        min_ (float):
        max_ (float):
        discrete (GetApiTracesFacetsResponse200Type0FacetsItemType1Discrete | Unset):
    """

    key: str
    kind: Literal["range"]
    label: str
    group: GetApiTracesFacetsResponse200Type0FacetsItemType1Group
    min_: float
    max_: float
    discrete: GetApiTracesFacetsResponse200Type0FacetsItemType1Discrete | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        kind = self.kind

        label = self.label

        group = self.group.value

        min_ = self.min_

        max_ = self.max_

        discrete: dict[str, Any] | Unset = UNSET
        if not isinstance(self.discrete, Unset):
            discrete = self.discrete.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "kind": kind,
                "label": label,
                "group": group,
                "min": min_,
                "max": max_,
            }
        )
        if discrete is not UNSET:
            field_dict["discrete"] = discrete

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_1_discrete import (
            GetApiTracesFacetsResponse200Type0FacetsItemType1Discrete,
        )

        d = dict(src_dict)
        key = d.pop("key")

        kind = cast(Literal["range"], d.pop("kind"))
        if kind != "range":
            raise ValueError(f"kind must match const 'range', got '{kind}'")

        label = d.pop("label")

        group = GetApiTracesFacetsResponse200Type0FacetsItemType1Group(d.pop("group"))

        min_ = d.pop("min")

        max_ = d.pop("max")

        _discrete = d.pop("discrete", UNSET)
        discrete: GetApiTracesFacetsResponse200Type0FacetsItemType1Discrete | Unset
        if isinstance(_discrete, Unset):
            discrete = UNSET
        else:
            discrete = GetApiTracesFacetsResponse200Type0FacetsItemType1Discrete.from_dict(_discrete)

        get_api_traces_facets_response_200_type_0_facets_item_type_1 = cls(
            key=key,
            kind=kind,
            label=label,
            group=group,
            min_=min_,
            max_=max_,
            discrete=discrete,
        )

        get_api_traces_facets_response_200_type_0_facets_item_type_1.additional_properties = d
        return get_api_traces_facets_response_200_type_0_facets_item_type_1

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
