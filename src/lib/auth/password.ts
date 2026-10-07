import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * scrypt (Node built-in, no new dependency) rather than a plain
 * SHA-256/MD5 hash — scrypt is deliberately slow/memory-hard, which is
 * what makes password hashes resistant to brute-force/rainbow-table
 * attacks. bcrypt would also work but isn't in Node's standard library,
 * so it would mean adding and vetting a new npm dependency for something
 * `node:crypto` already covers.
 */
const KEY_LENGTH = 64

export function hashPassword(password: string): {
  hash: string
  salt: string
} {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex')
  return { hash, salt }
}

export function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string,
): boolean {
  const candidate = scryptSync(password, storedSalt, KEY_LENGTH)
  const stored = Buffer.from(storedHash, 'hex')
  // Lengths can differ if storedHash is malformed/corrupted — guard before
  // timingSafeEqual, which throws on mismatched buffer lengths rather than
  // returning false.
  if (candidate.length !== stored.length) return false
  return timingSafeEqual(candidate, stored)
}