from enum import Enum


class PostApiCheckupRunResponse200RowsItemId(str, Enum):
    APP = "app"
    CANARY_COLLECTOR = "canary_collector"
    CANARY_EVALUATIONS = "canary_evaluations"
    CANARY_LANGY = "canary_langy"
    CANARY_PROCESSOR = "canary_processor"
    CANARY_SCENARIOS = "canary_scenarios"
    CLICKHOUSE = "clickhouse"
    CLICKHOUSE_MIGRATIONS = "clickhouse_migrations"
    CONNECT = "connect"
    EMAIL = "email"
    GATEWAY = "gateway"
    GATEWAY_CONTROL_PLANE = "gateway_control_plane"
    LICENSE = "license"
    LWQL = "lwql"
    MODEL_PROVIDERS = "model_providers"
    MODEL_PROVIDER_TEST = "model_provider_test"
    POSTGRES = "postgres"
    POSTGRES_MIGRATIONS = "postgres_migrations"
    REACH_CONNECT_HOST = "reach_connect_host"
    REACH_GATEWAY_HOST = "reach_gateway_host"
    REDIS = "redis"
    SMTP_VERIFY = "smtp_verify"
    STORAGE = "storage"
    STORAGE_PROBE = "storage_probe"
    USAGE_REPORT = "usage_report"

    def __str__(self) -> str:
        return str(self.value)
