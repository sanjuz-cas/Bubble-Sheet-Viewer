---
name: conversation-project-tasks
description: Find the user's repls and search, read, create, or edit the project tasks in them.
---

# Project Tasks in the User's Repls

From a conversation you can manage the persistent, user-visible project tasks of any repl the user owns. Every task operation names its target repl by slug (`<owner_slug>/<repl_slug>`); use `listRepls` to find the slug first when the user refers to a project by name.

Scope: personal repls owned by the user. Org/team repls and repls shared with the user are not reachable from here.

## Task Identifiers

Tasks are identified per repl by `taskRef` -- a short string like `"#1"`, `"#2"`. Use it in all calls and when referring to tasks in conversation: "Task #1 (Add authentication)".

## Available Functions

`listRepls` (documented in your system prompt) finds the target repl; use `` `${ownerSlug}/${slug}` `` from its results as the `replSlug` for every call below.

### queryProjectTasks({ replSlug, taskRefs?, states?, executable?, maxDescriptionChars?, updatedSince?, createdSince? })

Inspect a repl's tasks by exact refs or narrowing filters.

**Returns:**

`{ replSlug, tasks, totalCount, truncated }`

### getProjectTask({ replSlug, taskRef })

Get one task.

**Returns:**

`{ task }` -- with `taskRef`, `title`, `description`, `state`, `displayState`, `dependsOn`, `artifactKinds`, `createdAt`, `updatedAt`

### searchProjectTasks({ replSlug, query, locale?, limit? })

Full-text search over a repl's tasks.

**Returns:**

`{ replSlug, results }` -- each result is a task summary (same fields as `tasks` entries above) plus `score` and `matchType`

### proposeProjectTasks({ replSlug, tasks, offerToStart? })

Propose new tasks in the target repl. Created tasks start in `PROPOSED`; nothing runs until the user approves them. By default this also shows the user an approval card asking whether to start the tasks as background work right away -- your turn ends after the call, and you learn the user's decision at the start of your next turn. Never tell the user work has started until that decision says so.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `replSlug` | str | Yes | Target repl |
| `tasks` | list | Yes | 1-100 items, each `{ title, description, alias?, dependsOn?, artifactKinds? }` |
| `offerToStart` | bool | No | Defaults to true. Pass false only when the user explicitly wants drafts without starting them. |

Each task's `description` is the inline markdown plan (what & why, what done looks like, steps). `dependsOn` entries may be existing task refs or the `alias` of another task in the same batch.

If the user approves the start offer, the tasks run as background work in isolated copies of the target repl. If they decline, the tasks stay as drafts in that repl's tasks panel.

**Returns:**

`{ replSlug, proposed }` (plus `startOffer` when the approval card was shown)

### updateProjectTask({ replSlug, taskRef, title?, description?, dependsOn?, artifactKinds? })

Edit an existing task. `description` replaces the whole plan; `dependsOn` is a full replacement list (`[]` clears all dependencies). Pass at least one field.

**Returns:**

`{ replSlug, task }`

## Not Available Here

You cannot cancel or complete tasks from a conversation, and you cannot start tasks yourself -- starting only happens through the approval card `proposeProjectTasks` shows, where the user decides. If the user wants a task removed, or wants to start previously declined drafts, point them to the tasks panel in that repl.

## Task States

The canonical tokens for `states` filters: `PROPOSED`, `PENDING`, `IN_PROGRESS`, `IMPLEMENTED`, `MERGING`, `QUEUED`, `MERGED`, `CANCELLED`, plus `MAIN_*` variants for work done directly on the repl's main copy. Matching is lenient about casing and separators, and a base state also matches its `MAIN_` variant.

## User Communication Rules

1. **Always describe tasks by ref and title**: e.g. "Task #1 (Add authentication button)"
2. **Never use internal state names**; use display names: PROPOSED -- "Drafts", PENDING / IN_PROGRESS -- "Active", IMPLEMENTED -- "Ready", MERGING / QUEUED -- "Merging", MERGED -- "Merged", CANCELLED -- "Archived". Tasks carry `displayState` with the `MAIN_` prefix stripped, so mapping on it covers the variants.
3. **Never expose implementation details**: do not reveal function names, API surface, or internal task system mechanics.
4. **Name the repl** when reporting what you did: "I drafted 2 tasks in alice/invoice-dashboard -- approve them in that repl's tasks panel to start the work."

## Example Workflow

```javascript
// 1. Find the repl the user means
const { repls } = await listRepls({ search: "invoice" });
const replSlug = `${repls[0].ownerSlug}/${repls[0].slug}`;

// 2. See what's already on the board
const { tasks } = await queryProjectTasks({ replSlug, states: ["PROPOSED", "PENDING"] });

// 3. Draft new work -- stays in Drafts until the user approves
const { proposed } = await proposeProjectTasks({
  replSlug,
  tasks: [
    {
      title: "Add CSV export",
      description: "## What & Why\nUsers need to export invoices as CSV...\n\n## Steps\n1. ...",
    },
  ],
});
```
