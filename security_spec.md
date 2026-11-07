# Firestore Security Specification — ChromaEvidence

## 1. Authentication & Identity Invariants
- All access requires an authenticated user (`request.auth != null`) with a verified email (`request.auth.token.email_verified == true`).
- Path wildcard IDs (`userId`, `recordId`) must satisfy `isValidId(id)`: string of length 1..128 matching `^[a-zA-Z0-9_-]+$`.
- Default catch-all rule (`match /{document=**}`) denies all reads and writes.

## 2. Collection: `/users/{userId}` (`UserProfile`)
- **Read (`get`, `list`)**: Allowed only when `request.auth.uid == userId` and `resource.data.ownerUid == request.auth.uid`.
- **Create (`create`)**:
  - `request.auth.uid == userId`
  - Exact key set via `hasAll` and `hasOnly`: `['ownerUid', 'email', 'operatorId', 'name', 'unit', 'keyFingerprint', 'publicKeyJwkJson', 'createdAt', 'updatedAt']`
  - `ownerUid == request.auth.uid`
  - `email == request.auth.token.email` and `email.size() <= 254`
  - `operatorId` (1..64 chars), `name` (1..120 chars), `unit` (1..160 chars)
  - `keyFingerprint` (64 chars hex), `publicKeyJwkJson` (10..2048 chars)
  - `createdAt == request.time` and `updatedAt == request.time`
- **Update (`update`)**:
  - `request.auth.uid == userId` and `resource.data.ownerUid == request.auth.uid`
  - Immutable fields: `ownerUid == resource.data.ownerUid`, `createdAt == resource.data.createdAt`
  - `updatedAt == request.time`
- **Delete (`delete`)**: Denied (`allow delete: if false;`).

## 3. Collection: `/records/{recordId}` (`EvidenceRecord`)
- **Read (`get`, `list`)**: Allowed only when `resource.data.ownerUid == request.auth.uid`.
- **Create (`create`)**:
  - Exact key set via `hasAll` and `hasOnly`: `['ownerUid', 'recordId', 'caseRef', 'kitId', 'kitName', 'effectiveResult', 'recordHash', 'previousRecordHash', 'imageSha256', 'operatorId', 'keyFingerprint', 'recordJson', 'capturedAtIso', 'createdAt']`
  - `ownerUid == request.auth.uid`
  - `recordId == recordId` (matches path wildcard)
  - `effectiveResult in ['POSITIVE', 'NEGATIVE', 'INCONCLUSIVE']`
  - `recordHash.size() == 64`, `previousRecordHash.size() == 64`, `imageSha256.size() == 64`, `keyFingerprint.size() == 64`
  - `recordJson.size() >= 20 && recordJson.size() <= 100000`
  - `createdAt == request.time`
- **Update / Delete (`update`, `delete`)**: Strictly denied (`allow update, delete: if false;`) — evidence records are immutable and append-only.
