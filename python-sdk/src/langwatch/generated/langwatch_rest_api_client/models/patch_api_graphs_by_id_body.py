from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_graphs_by_id_body_filters import PatchApiGraphsByIdBodyFilters
    from ..models.patch_api_graphs_by_id_body_graph import PatchApiGraphsByIdBodyGraph


T = TypeVar("T", bound="PatchApiGraphsByIdBody")


@_attrs_define
class PatchApiGraphsByIdBody:
    """
    Attributes:
        name (str | Unset):
        graph (PatchApiGraphsByIdBodyGraph | Unset):
        filters (PatchApiGraphsByIdBodyFilters | Unset):
    """

    name: str | Unset = UNSET
    graph: PatchApiGraphsByIdBodyGraph | Unset = UNSET
    filters: PatchApiGraphsByIdBodyFilters | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        graph: dict[str, Any] | Unset = UNSET
        if not isinstance(self.graph, Unset):
            graph = self.graph.to_dict()

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if graph is not UNSET:
            field_dict["graph"] = graph
        if filters is not UNSET:
            field_dict["filters"] = filters

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_graphs_by_id_body_filters import PatchApiGraphsByIdBodyFilters
        from ..models.patch_api_graphs_by_id_body_graph import PatchApiGraphsByIdBodyGraph

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _graph = d.pop("graph", UNSET)
        graph: PatchApiGraphsByIdBodyGraph | Unset
        if isinstance(_graph, Unset):
            graph = UNSET
        else:
            graph = PatchApiGraphsByIdBodyGraph.from_dict(_graph)

        _filters = d.pop("filters", UNSET)
        filters: PatchApiGraphsByIdBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PatchApiGraphsByIdBodyFilters.from_dict(_filters)

        patch_api_graphs_by_id_body = cls(
            name=name,
            graph=graph,
            filters=filters,
        )

        patch_api_graphs_by_id_body.additional_properties = d
        return patch_api_graphs_by_id_body

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
