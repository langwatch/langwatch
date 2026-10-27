"""
Deprecated: the Dashboards facade was called `boards`; use `langwatch.dashboards`.

`BoardsFacade` is `DashboardsFacade`; methods take `dashboard_id`, not `board_id`.

Spec: modules/dashboard/specs/dashboards-v2.feature (AC199w)
"""

import warnings

from langwatch.dashboards import DashboardsFacade

warnings.warn(
    "langwatch.boards is deprecated; use langwatch.dashboards",
    DeprecationWarning,
    stacklevel=2,
)

BoardsFacade = DashboardsFacade

__all__ = ["BoardsFacade"]
