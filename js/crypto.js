/* crypto.js — password → AES-256-GCM decryption of data/log.enc
 *
 * Wire format of the blob:
 *   bytes 0..4    magic "PLOG1" (ASCII)
 *   bytes 5..20   salt   (16 bytes, random per publish)
 *   bytes 21..32  IV     (12 bytes, random per publish)
 *   bytes 33..    AES-256-GCM ciphertext || tag (16 bytes)
 *
 * KDF: PBKDF2-HMAC-SHA256, 200 000 iterations, 256-bit key.
 * Must stay in sync with scripts/encrypt.py.
 */
"use strict";

const ENC_MAGIC = "PLOG1";
const PBKDF2_ITERATIONS = 200000;

async function decryptBlob(password, blobBytes) {
  if (blobBytes.length < 33 + 16) {
    throw new Error("Encrypted blob is too short");
  }
  const magic = new TextDecoder().decode(blobBytes.slice(0, 5));
  if (magic !== ENC_MAGIC) {
    throw new Error("Not a recognized encrypted blob");
  }
  const salt = blobBytes.slice(5, 21);
  const iv = blobBytes.slice(21, 33);
  const ciphertext = blobBytes.slice(33);

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ciphertext
  );
  return new Uint8Array(plainBuffer);
}
