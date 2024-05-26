import boto3
import os
from enum import Enum
import json


class RDSEventID(Enum):
    SNAPSHOT_CREATION_COMPLETE = "RDS-EVENT-0042"


rds_client = boto3.client("rds")


def lambda_handler(event, context):
    event_attributes = event["Records"][0]["Sns"]["MessageAttributes"]
    if (
        event_attributes["EventID"]["Value"]
        != RDSEventID.SNAPSHOT_CREATION_COMPLETE.value
    ):
        message = {
            "statusCode": 200,
            "body": "Event ID is not for snapshot creation completion, returning early.",
        }
        print(message)
        return message
    snapshot_event = event["Records"][0]["Sns"]["Message"]
    snapshot_event = json.loads(snapshot_event)

    snapshot_identifier = snapshot_event["Source ID"]
    snapshot_arn = snapshot_event["Source ARN"]

    response = rds_client.start_export_task(
        ExportTaskIdentifier=f"export-{snapshot_identifier}",
        SourceArn=snapshot_arn,
        S3BucketName=os.environ["BUCKET_NAME"],
        IamRoleArn=os.environ["IAM_ROLE_ARN"],
        KmsKeyId=os.environ["KMS_KEY_ID"],
        S3Prefix=f"export-{snapshot_identifier}",
    )

    message = {
        "statusCode": response["ResponseMetadata"]["HTTPStatusCode"],
        "body": f'Started export task {response["ExportTaskIdentifier"]}',
    }
    print(message)
    return message
