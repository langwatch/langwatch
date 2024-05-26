import boto3
import os
from datetime import datetime
from zoneinfo import ZoneInfo

rds_client = boto3.client("rds")


def lambda_handler(event, context):
    db_instance_identifier = os.environ["DB_INSTANCE_IDENTIFIER"]
    # create a timestamp with AMS timezone format
    ams_tz = ZoneInfo("Europe/Amsterdam")
    timestamp = datetime.now(ams_tz).strftime("on-%Y-%m-%d-at-%H-%M")
    snapshot_identifier = f"{db_instance_identifier}-snapshot-{timestamp}"

    # Create RDS snapshot
    response = rds_client.create_db_snapshot(
        DBInstanceIdentifier=db_instance_identifier,
        DBSnapshotIdentifier=snapshot_identifier,
    )

    message = {
        "statusCode": response["ResponseMetadata"]["HTTPStatusCode"],
        "body": f"Snapshot {snapshot_identifier} creation initiated.",
    }
    print(message)
    return message
