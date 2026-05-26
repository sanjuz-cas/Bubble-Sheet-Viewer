---
name: Auth architecture
description: BubbleScan auth and encryption design — JWT + bcrypt + AES-256-GCM server-side encryption.
---

**Rule:** All auth flows through lib/auth-token.ts (module-level token store). Never hardcode tokens or use AsyncStorage directly for auth.

**Why:** SecureStore on native, localStorage on web. Module-level token allows synchronous access in lib/storage.ts fetch calls without circular imports.

**Key files:**
- `lib/auth-token.ts` — setAuthToken/getAuthToken/authHeaders()
- `contexts/AuthContext.tsx` — AuthProvider, useAuth hook; sets token on login/register, clears on logout
- `server/auth-utils.ts` — hashPassword, verifyPassword, signToken, verifyToken, encrypt, decrypt
- `server/routes.ts` — requireAuth middleware, all API routes protected

**Encryption:** AES-256-GCM, key derived from SESSION_SECRET padded to 32 bytes. Format: `iv.authTag.ciphertext` (base64 dot-separated). Applied to answerKeys.answersEncrypted and scanResults.dataEncrypted.

**JWT:** 30-day expiry, signed with SESSION_SECRET.
