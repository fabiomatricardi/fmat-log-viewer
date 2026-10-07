#!/usr/bin/env python3
"""encrypt.py — encrypt the SQLite database into an AES-256-GCM blob.

Usage:
    python scripts/encrypt.py <input.db> <output.enc>

The password is prompted interactively (hidden), or read from stdin when it
is piped in (used by publish.ps1).

Wire format of the output (must match js/crypto.js):
    bytes 0..4    magic "PLOG1" (ASCII)
    bytes 5..20   salt   (16 random bytes)
    bytes 21..32  IV     (12 random bytes)
    bytes 33..    AES-256-GCM ciphertext || tag
Key: PBKDF2-HMAC-SHA256, 200 000 iterations, 256-bit.
"""

import getpass
import os
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

MAGIC = b"PLOG1"
PBKDF2_ITERATIONS = 200_000
SALT_LEN = 16
IV_LEN = 12


def derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return kdf.derive(password.encode("utf-8"))


def read_password() -> str:
    if not sys.stdin.isatty():
        pw = sys.stdin.readline().rstrip("\n")
    else:
        pw = getpass.getpass("Password: ")
    if not pw:
        sys.exit("error: empty password")
    return pw


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip().splitlines()[2].strip())

    src, dst = sys.argv[1], sys.argv[2]
    if not os.path.isfile(src):
        sys.exit(f"error: input not found: {src}")

    password = read_password()

    with open(src, "rb") as f:
        plaintext = f.read()

    salt = os.urandom(SALT_LEN)
    iv = os.urandom(IV_LEN)
    key = derive_key(password, salt)
    ciphertext = AESGCM(key).encrypt(iv, plaintext, None)

    blob = MAGIC + salt + iv + ciphertext
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    tmp = dst + ".tmp"
    with open(tmp, "wb") as f:
        f.write(blob)
    os.replace(tmp, dst)

    print(
        f"encrypted {src} ({len(plaintext)} bytes) -> {dst} ({len(blob)} bytes)"
    )


if __name__ == "__main__":
    main()
