---
name: Metro crash fix
description: Metro FallbackWatcher crashes when Replit creates/deletes temp files inside the project workspace during workflow restarts.
---

**Rule:** Always add a blockList to metro.config.js that excludes `.local` and `.agents` directories.

**Why:** Replit creates transient files under `.local/state/workflow-logs/` and `.local/skills/` that disappear mid-watch. Metro's FallbackWatcher throws ENOENT and crashes the dev server.

**How to apply:** In metro.config.js:
```js
config.resolver.blockList = [/\/\.local\/.*/, /\/\.agents\/.*/];
```

**Workaround when it still crashes:** Use restart_workflow("Start Frontend") — it clears the stale watcher state.
