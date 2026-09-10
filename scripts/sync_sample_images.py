"""Restore the explorer's selected photographs from the anonymous dataset release.

Uses only the Python standard library. Files are copied byte-for-byte, never resized
or recompressed. Downloaded content must match the release's file checksums before
any existing sample is replaced.
"""

import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
API = "https://anonymous-hf.com/api/a/yx8guz54j8ct/"


def fetch(path):
    for attempt in range(4):
        try:
            request = Request(API + path, headers={"User-Agent": "VDBench-Explorer-Image-Sync"})
            with urlopen(request, timeout=60) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError, ConnectionError):
            if attempt == 3:
                raise RuntimeError(f"Could not retrieve dataset file: {path}") from None
            time.sleep(2 ** attempt)


def topic_files(topic):
    topic_id = topic["id"]
    if not isinstance(topic_id, int):
        raise ValueError("Invalid topic identifier")
    entries = json.loads(fetch(f"tree/images/entry_{topic_id}"))
    listing = {entry["path"]: entry for entry in entries if entry["type"] == "file"}
    jobs = []
    for period in topic["temporal_evolution"]:
        for image in period.get("images", []):
            image_id = image["image_id"]
            if not re.fullmatch(r"img_[a-f0-9]+", image_id):
                raise ValueError("Invalid image identifier")
            source = f"images/entry_{topic_id}/{image_id}.jpg"
            if source not in listing:
                raise ValueError(f"Selected image is absent from the dataset: {image_id}")
            target = (DATA / image["src"]).resolve()
            if not target.is_relative_to((DATA / "images").resolve()) or target.suffix != ".jpg":
                raise ValueError("Sample path must stay inside data/images")
            jobs.append((image, source, target, listing[source]))
    return jobs


def download(job, staging):
    image, source, target, metadata = job
    contents = fetch("resolve/" + source)
    sha256 = hashlib.sha256(contents).hexdigest()
    if len(contents) != metadata["size"] or not contents.startswith(b"\xff\xd8\xff"):
        raise ValueError(f"Invalid image download: {image['image_id']}")
    if metadata.get("lfs"):
        if sha256 != metadata["lfs"]["oid"]:
            raise ValueError(f"Dataset checksum mismatch: {image['image_id']}")
    else:
        blob = b"blob " + str(len(contents)).encode() + b"\0" + contents
        if hashlib.sha1(blob).hexdigest() != metadata["oid"]:
            raise ValueError(f"Dataset checksum mismatch: {image['image_id']}")
    staged = staging / target.relative_to(DATA)
    staged.parent.mkdir(parents=True, exist_ok=True)
    staged.write_bytes(contents)
    image["sha256"] = sha256
    return target, staged, sha256


def sync(workers):
    topic_path = DATA / "topics.json"
    original_topics = topic_path.read_bytes()
    topics = json.loads(original_topics)
    print("Matching selected image IDs against the dataset release…", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = [job for group in pool.map(topic_files, topics) for job in group]
    if not jobs or len({job[2] for job in jobs}) != len(jobs):
        raise ValueError("Expected a nonempty selection with unique sample paths")

    with tempfile.TemporaryDirectory(prefix="vdbench-originals-") as temporary:
        staging = Path(temporary) / "downloads"
        verified = []
        last_progress = -1
        print("Downloading original JPEGs and verifying release checksums…", flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(download, job, staging) for job in jobs]
            for future in concurrent.futures.as_completed(futures):
                verified.append(future.result())
                progress = len(verified) * 10 // len(jobs)
                if progress != last_progress:
                    print(f"Verified download progress: {progress * 10}%", flush=True)
                    last_progress = progress

        # Finish downloading first; preserve the current files for rollback.
        backups = Path(temporary) / "backups"
        for target, _, _ in verified:
            backup = backups / target.relative_to(DATA)
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(target, backup)
        installed = []
        topic_temp = topic_path.with_suffix(".json.tmp")
        try:
            print("Installing verified originals…", flush=True)
            for target, staged, expected in verified:
                installed.append(target)
                shutil.copyfile(staged, target)
                if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
                    raise ValueError("Installed image failed checksum validation")
            topic_temp.write_text(json.dumps(topics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            topic_temp.replace(topic_path)
        except BaseException:
            for target in installed:
                shutil.copyfile(backups / target.relative_to(DATA), target)
            topic_path.write_bytes(original_topics)
            topic_temp.unlink(missing_ok=True)
            raise

    print("Complete. Selected photographs match the dataset originals byte-for-byte.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=6, choices=range(1, 9), metavar="1-8")
    args = parser.parse_args()
    sync(args.workers)
