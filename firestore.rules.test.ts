/**
 * Adversarial "Dirty Dozen" Security Rules Test Suite for ChromaEvidence.
 * Verifies schema validation, size limits, ownership, immutability, and append-only guarantees.
 */

export const DIRTY_DOZEN_PAYLOADS = {
  nullValue: null,
  emptyString: '',
  oversizedString: 'A'.repeat(150000),
  negativeNumber: -999999,
  nanValue: Number.NaN,
  infinityValue: Number.POSITIVE_INFINITY,
  wrongTypeIntForString: 12345,
  wrongTypeListForMap: ['unexpected', 'array'],
  extraKeyInjection: { isAdmin: true, role: 'superadmin' },
  spoofedOwnerUid: 'attacker-uid-9999',
  forgedFutureTimestamp: new Date(Date.now() + 86400000 * 365).toISOString(),
};
