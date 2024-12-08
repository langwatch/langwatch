import asyncio
import signal
import subprocess
import boto3
import os
import time
import threading

from langwatch_nlp.studio.runtimes.base_runtime import ServerEventQueue
from langwatch_nlp.studio.types.events import StudioClientEvent
from langwatch_nlp.studio.s3_cache import s3_client_and_bucket
from langwatch_nlp.logger import get_logger

logger = get_logger(__name__)


def stop_process(trace_id: str, s3_cache_key: str):
    try:
        s3_client, bucket_name = s3_client_and_bucket()
        if not bucket_name:
            raise Exception("CACHE_BUCKET not set, could not kill process")

        # Create an empty file in the kill directory
        kill_key = f"kill/{s3_cache_key}/{trace_id}"
        s3_client.put_object(Bucket=bucket_name, Key=kill_key, Body=b"")  # empty file
        logger.info(f"Created kill file at s3://{bucket_name}/{kill_key}")
    except Exception as e:
        logger.error(f"Failed to create kill file in S3: {str(e)}")
        raise Exception(f"Failed kill process")


def setup_kill_signal_watcher(
    event: StudioClientEvent, queue: ServerEventQueue, s3_cache_key: str, trace_id: str
):
    """
    Sets up a watcher to check for a kill signal file in S3.
    If the file is found, the process will terminate immediately.

    Args:
        s3_cache_key: The cache key for the current session.
        trace_id: The unique identifier for the current process.
    """

    def watch_for_kill_signal():
        s3_client, bucket_name = s3_client_and_bucket()
        if not bucket_name:
            logger.warning(
                "Warning: CACHE_BUCKET not set, kill signal watcher disabled"
            )
            return

        kill_key = f"kill/{s3_cache_key}/{trace_id}"

        while True:
            try:
                # Attempt to fetch the kill file
                s3_client.head_object(Bucket=bucket_name, Key=kill_key)
                logger.info(f"Kill signal detected for trace_id {trace_id}. Exiting...")
                from langwatch_nlp.studio.app import handle_interruption

                task = handle_interruption(event)

                if stop_event := asyncio.run(task):
                    logger.info(f"Sending end event: {stop_event}")
                    # Empty the queue to send the stop event right away
                    while not queue.empty():
                        try:
                            queue.get_nowait()
                        except:
                            break
                    queue.put_nowait(stop_event)
                # Wait a bit to make sure the event is sent
                time.sleep(1.0)

                # Try all the ways to kill the process
                try:
                    # Kill the process group
                    os.killpg(os.getpgid(0), signal.SIGKILL)
                except Exception as e:
                    logger.error(f"killpg failed: {str(e)}")

                try:
                    # Kill all python processes
                    subprocess.run(["killall", "-9", "python"], check=False)
                    subprocess.run(["killall", "-9", "python3"], check=False)
                except Exception as e:
                    logger.error(f"killall failed: {str(e)}")

                # If we're still alive, exit
                os._exit(1)
            except s3_client.exceptions.ClientError as e:
                if (
                    e.response["Error"]["Code"] == "404"
                    or e.response["Error"]["Code"] == "403"
                ):
                    # Kill file not found, continue watching
                    pass
                else:
                    logger.error(f"Error checking for kill signal: {str(e)}")

            # Sleep for a short period before checking again
            time.sleep(0.5)

    # Start the watcher in a separate thread
    watcher_thread = threading.Thread(target=watch_for_kill_signal)
    watcher_thread.daemon = True  # Ensure the thread doesn't prevent program exit
    watcher_thread.start()
