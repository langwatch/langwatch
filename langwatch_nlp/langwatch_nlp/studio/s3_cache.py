import json
import os
import tempfile
import boto3
from langwatch_nlp.logger import get_logger
from langwatch_nlp.studio.utils import set_dspy_cache_dir
from threading import Timer, Lock
import queue

logger = get_logger(__name__)


class S3Syncer:
    def __init__(
        self,
        local_dir: str,
        bucket: str,
        s3_prefix: str,
        s3_client,
        known_files: list[str],
        throttle_seconds: int = 2,
    ):
        self.local_dir = local_dir
        self.bucket = bucket
        self.s3_prefix = s3_prefix.lstrip("/")  # Remove leading slash for S3 keys
        self.s3_client = s3_client
        self.throttle_seconds = throttle_seconds
        self.pending_uploads = queue.Queue()
        self.timer: Timer | None = None
        self.lock = Lock()
        self.known_files = set(known_files)  # Track known files

    def schedule_upload(self):
        with self.lock:
            if self.timer:
                self.timer.cancel()
            self.timer = Timer(self.throttle_seconds, self.process_uploads)
            self.timer.daemon = (
                True  # Make sure the timer thread doesn't prevent program exit
            )
            self.timer.start()

    def process_uploads(self):
        files_to_upload = set()
        while not self.pending_uploads.empty():
            try:
                files_to_upload.add(self.pending_uploads.get_nowait())
            except queue.Empty:
                break

        new_files_added = False
        for local_path in files_to_upload:
            try:
                relative_path = os.path.relpath(local_path, self.local_dir)
                if not os.path.exists(local_path):
                    continue

                s3_key = f"{self.s3_prefix}/{relative_path}"
                logger.info(f"Uploading {local_path} to s3://{self.bucket}/{s3_key}")
                self.s3_client.upload_file(local_path, self.bucket, s3_key)

                if relative_path not in self.known_files:
                    self.known_files.add(relative_path)
                    new_files_added = True

            except Exception as e:
                logger.error(f"Error uploading {local_path}: {str(e)}")

        # Update files.json if new files were added
        if new_files_added:
            try:
                files_json = json.dumps(list(self.known_files))
                files_json_path = os.path.join(self.local_dir, "files.json")
                with open(files_json_path, "w") as f:
                    f.write(files_json)

                s3_key = f"{self.s3_prefix}/files.json"
                self.s3_client.upload_file(files_json_path, self.bucket, s3_key)
            except Exception as e:
                logger.error(f"Error updating files.json: {str(e)}")

    def process_deletions(self, file_path: str):
        self.known_files.discard(file_path)


def s3_client_and_bucket():
    s3_client = boto3.client(
        "s3",
        endpoint_url=os.environ.get("AWS_ENDPOINT_URL"),
    )
    bucket_name = os.environ.get("CACHE_BUCKET")

    return s3_client, bucket_name


def setup_s3_cache(s3_cache_key: str):
    """
    Sets up S3-based caching for DSPy optimizations.
    Creates local cache directory and mounts S3 paths for syncing.

    Args:
        s3_cache_key: Customer-specific secret key that determines their cache folder
    """
    if not s3_cache_key:
        return

    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler

    class S3WatchHandler(FileSystemEventHandler):
        def __init__(self, syncer: S3Syncer):
            self.syncer = syncer

        def on_modified(self, event):
            if not event.is_directory:
                self.syncer.pending_uploads.put(event.src_path)
                self.syncer.schedule_upload()

        def on_created(self, event):
            if not event.is_directory:
                self.syncer.pending_uploads.put(event.src_path)
                self.syncer.schedule_upload()

        def on_deleted(self, event):
            if not event.is_directory:
                self.syncer.process_deletions(event.src_path)

    s3_client, bucket_name = s3_client_and_bucket()
    if not bucket_name:
        logger.warning("Warning: CACHE_BUCKET not set, caching disabled")
        return

    # Create temp directory for cache
    local_cache_dir = tempfile.mkdtemp(prefix="dspy_cache_")

    # Define cache path
    bucket_cache_path = f"/cache/{s3_cache_key}"

    logger.info("Fetching cache from s3 for optimization...")

    # Download existing cache files if any
    known_files = download_cache_files(
        s3_client, bucket_name, bucket_cache_path, local_cache_dir
    )

    if len(known_files) > 0:
        logger.info("Cache fetched from s3")

    # Mount S3 path for real-time sync
    local_cache_mount_point = os.path.join(local_cache_dir, "cache")
    os.makedirs(local_cache_mount_point, exist_ok=True)

    # Set up the file watcher
    syncer = S3Syncer(
        local_dir=local_cache_dir,
        bucket=bucket_name,
        s3_prefix=bucket_cache_path,
        s3_client=s3_client,
        known_files=known_files,
    )
    event_handler = S3WatchHandler(syncer)
    observer = Observer()
    observer.schedule(event_handler, local_cache_dir, recursive=True)
    observer.daemon = (
        True  # Make the observer thread daemon so it doesn't prevent program exit
    )
    observer.start()

    # Set DSPy to use our cache directory
    set_dspy_cache_dir(local_cache_dir)


def download_cache_files(
    s3_client, bucket_name: str, bucket_cache_path: str, local_cache_dir: str
):
    known_files: list[str] = []
    try:
        with tempfile.NamedTemporaryFile() as tmp_file:
            s3_client.download_file(
                bucket_name,
                f"{bucket_cache_path.lstrip('/')}/files.json",
                tmp_file.name,
            )
            with open(tmp_file.name) as f:
                known_files = json.load(f)
    except Exception as e:
        logger.info(f"No existing files.json found or error reading it: {str(e)}")
        # Create new files.json
        with open(os.path.join(local_cache_dir, "files.json"), "w") as f:
            json.dump([], f)

    # Download all known cache files
    for file_path in known_files:
        try:
            s3_key = f"{bucket_cache_path.lstrip('/')}/{file_path}"
            local_path = os.path.join(local_cache_dir, file_path)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            s3_client.download_file(bucket_name, s3_key, local_path)
        except Exception as e:
            logger.warning(f"Error downloading {file_path}: {str(e)}")

    return known_files
