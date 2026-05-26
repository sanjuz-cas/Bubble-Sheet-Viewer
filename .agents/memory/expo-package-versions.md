---
name: Expo package versions
description: Expo SDK 54 requires specific lower versions of expo-* packages; npm install picks wrong major versions.
---

**Rule:** Always use `installLanguagePackages` with pinned Expo-compatible versions, not bare package names.

**Why:** npm install expo-secure-store installs v56 (latest) but Expo 54 needs ~15.0.x. Same for expo-sharing (needs ~14.0.x vs v56). Wrong versions break Expo Go.

**How to apply:**
- expo-secure-store: `expo-secure-store@~15.0.8`
- expo-sharing: `expo-sharing@~14.0.8`
- Always check the "expected version" warnings in the Start Frontend log and match them.
