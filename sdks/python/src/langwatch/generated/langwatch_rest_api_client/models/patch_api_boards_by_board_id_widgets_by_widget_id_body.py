from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_queries_item import (
        PatchApiBoardsByBoardIdWidgetsByWidgetIdBodyQueriesItem,
    )
    from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_0 import (
        PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType0,
    )
    from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_1 import (
        PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType1,
    )
    from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_2 import (
        PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType2,
    )
    from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_3 import (
        PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType3,
    )


T = TypeVar("T", bound="PatchApiBoardsByBoardIdWidgetsByWidgetIdBody")


@_attrs_define
class PatchApiBoardsByBoardIdWidgetsByWidgetIdBody:
    """
    Attributes:
        name (str | Unset):
        code (str | Unset):
        queries (list[PatchApiBoardsByBoardIdWidgetsByWidgetIdBodyQueriesItem] | Unset):
        description (str | Unset):
        source (PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType0 |
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType1 |
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType2 |
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType3 | Unset):
    """

    name: str | Unset = UNSET
    code: str | Unset = UNSET
    queries: list[PatchApiBoardsByBoardIdWidgetsByWidgetIdBodyQueriesItem] | Unset = UNSET
    description: str | Unset = UNSET
    source: (
        PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType0
        | PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType1
        | PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType2
        | PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType3
        | Unset
    ) = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_0 import (
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType0,
        )
        from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_1 import (
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType1,
        )
        from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_2 import (
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType2,
        )

        name = self.name

        code = self.code

        queries: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.queries, Unset):
            queries = []
            for queries_item_data in self.queries:
                queries_item = queries_item_data.to_dict()
                queries.append(queries_item)

        description = self.description

        source: dict[str, Any] | Unset
        if isinstance(self.source, Unset):
            source = UNSET
        elif isinstance(self.source, PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType0):
            source = self.source.to_dict()
        elif isinstance(self.source, PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType1):
            source = self.source.to_dict()
        elif isinstance(self.source, PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType2):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if code is not UNSET:
            field_dict["code"] = code
        if queries is not UNSET:
            field_dict["queries"] = queries
        if description is not UNSET:
            field_dict["description"] = description
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_queries_item import (
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodyQueriesItem,
        )
        from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_0 import (
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType0,
        )
        from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_1 import (
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType1,
        )
        from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_2 import (
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType2,
        )
        from ..models.patch_api_boards_by_board_id_widgets_by_widget_id_body_source_type_3 import (
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType3,
        )

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        code = d.pop("code", UNSET)

        _queries = d.pop("queries", UNSET)
        queries: list[PatchApiBoardsByBoardIdWidgetsByWidgetIdBodyQueriesItem] | Unset = UNSET
        if _queries is not UNSET:
            queries = []
            for queries_item_data in _queries:
                queries_item = PatchApiBoardsByBoardIdWidgetsByWidgetIdBodyQueriesItem.from_dict(queries_item_data)

                queries.append(queries_item)

        description = d.pop("description", UNSET)

        def _parse_source(
            data: object,
        ) -> (
            PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType0
            | PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType1
            | PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType2
            | PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType3
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType0.from_dict(data)

                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_1 = PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType1.from_dict(data)

                return source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_2 = PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType2.from_dict(data)

                return source_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_3 = PatchApiBoardsByBoardIdWidgetsByWidgetIdBodySourceType3.from_dict(data)

            return source_type_3

        source = _parse_source(d.pop("source", UNSET))

        patch_api_boards_by_board_id_widgets_by_widget_id_body = cls(
            name=name,
            code=code,
            queries=queries,
            description=description,
            source=source,
        )

        patch_api_boards_by_board_id_widgets_by_widget_id_body.additional_properties = d
        return patch_api_boards_by_board_id_widgets_by_widget_id_body

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
