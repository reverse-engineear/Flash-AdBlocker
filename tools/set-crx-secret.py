#!/usr/bin/env python3
"""Put each extension's signing key into the CRX_KEYS_JSON repository secret.

Runs in your own terminal. The private key is read from a file you point at and is
never printed, so nothing sensitive passes through chat or logs.

  python tools/set-crx-secret.py --add flash-adblocker /path/to/key.pem
  python tools/set-crx-secret.py --list
  python tools/set-crx-secret.py --push

Keys are mirrored to ~/.crx-keys/<owner>__<repo>.json because GitHub never returns
a secret's value, so that file is what lets you add a second extension later without
losing the first. Keep a copy off this machine.
"""
import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

try:
    import requests
    from cryptography.hazmat.primitives.serialization import load_pem_private_key, PublicFormat, Encoding
except ImportError as missing:
    sys.exit(f"missing dependency: {missing.name}\nrun: python -m pip install requests cryptography pynacl")

API = "https://api.github.com"
SECRET_NAME = "CRX_KEYS_JSON"


def repo_from_git():
    try:
        url = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True, check=True).stdout.strip()
    except subprocess.CalledProcessError:
        return None
    hit = re.search(r"github\.com[:/]([\w.-]+)/([\w.-?]+?)(?:\.git)?$", url)
    return f"{hit.group(1)}/{hit.group(2)}" if hit else None


def token():
    if os.environ.get("GITHUB_TOKEN"):
        return os.environ["GITHUB_TOKEN"]
    try:
        out = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                             capture_output=True, text=True, timeout=30).stdout
    except subprocess.TimeoutExpired:
        return None
    for line in out.splitlines():
        if line.startswith("password="):
            return line[len("password="):]
    return None


def extension_id(pem_bytes):
    """Chrome derives the extension ID from the signing key, so this names your future listing."""
    key = load_pem_private_key(pem_bytes, password=None)
    der = key.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
    return "".join(chr(ord("a") + int(nibble, 16)) for nibble in hashlib.sha256(der).hexdigest()[:32])


def store_path(repo):
    return Path.home() / ".crx-keys" / (repo.replace("/", "__") + ".json")


def read_store(repo):
    path = store_path(repo)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_store(repo, keys):
    path = store_path(repo)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(keys, indent=2, sort_keys=True), encoding="utf-8")
    os.chmod(path, 0o600)
    return path


def upload_secret(repo, name, value, headers):
    try:
        from nacl.public import PublicKey, SealedBox
    except ImportError:
        sys.exit("missing dependency: nacl\nrun: python -m pip install pynacl")
    box = requests.get(f"{API}/repos/{repo}/actions/secrets/public-key", headers=headers, timeout=30)
    box.raise_for_status()
    info = box.json()
    sealed = SealedBox(PublicKey(base64.b64decode(info["key"]))).encrypt(value.encode())
    put = requests.put(f"{API}/repos/{repo}/actions/secrets/{name}", headers=headers, timeout=30,
                       json={"key_id": info["key_id"], "encrypted_value": base64.b64encode(sealed).decode()})
    put.raise_for_status()
    return put.status_code


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", default=repo_from_git(), help="owner/name, defaults to the git origin remote")
    parser.add_argument("--add", nargs=2, metavar=("SLUG", "PEM"), action="append",
                        help="record a key for one extension folder, repeatable")
    parser.add_argument("--list", action="store_true", help="show which slugs are stored and their extension IDs")
    parser.add_argument("--push", action="store_true", help="upload the stored keys to the repository secret")
    parser.add_argument("--dry-run", action="store_true", help="do everything except call the API")
    args = parser.parse_args()

    if not args.repo:
        sys.exit("no repo given and origin is not a GitHub remote; pass --repo owner/name")

    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    keys = read_store(args.repo)
    changed = False

    for slug, pem_path in args.add or []:
        path = Path(pem_path)
        if not path.is_file():
            sys.exit(f"{pem_path}: no such file")
        raw = path.read_bytes()
        try:
            ext_id = extension_id(raw)  # also rejects anything that is not a usable private key
        except ValueError:
            sys.exit(f"{pem_path}: not a private key in PEM format (Chrome's key.pem is PKCS#8, starting "
                     f"-----BEGIN PRIVATE KEY-----)")
        keys[slug] = base64.b64encode(raw).decode()
        changed = True
        print(f"recorded {slug}: extension id {ext_id} ({len(raw)} byte key)")
        folders = {p.parent.name for p in Path("extensions").glob("*/manifest.json")}
        if folders and slug not in folders:
            print(f"  note: no extensions/{slug}/manifest.json here, so CI will not look for this key")

    if changed:
        print(f"stored in {write_store(args.repo, keys)}")

    if args.list:
        if not keys:
            print(f"nothing stored for {args.repo} yet")
        for slug in sorted(keys):
            der_id = extension_id(base64.b64decode(keys[slug]))
            print(f"  {slug}: extension id {der_id}")

    if args.push or (changed and not args.list):
        value = json.dumps(keys, separators=(",", ":"), sort_keys=True)
        if args.dry_run:
            print(f"dry run: would upload {len(keys)} key(s) as {SECRET_NAME} ({len(value)} bytes of JSON)")
            return
        headers["Authorization"] = f"Bearer {token() or getpass.getpass('GitHub token: ')}"
        code = upload_secret(args.repo, SECRET_NAME, value, headers)
        print(f"{SECRET_NAME} updated on {args.repo} (HTTP {code})")


if __name__ == "__main__":
    main()
