---
name: repl-handoff
description: Move this conversation into a Repl, or create a separate Repl for a different piece of work — with or without a confirmation card.
---

# Repl Handoff

This conversation's sandbox is temporary — there is no persistent Repl the
user owns, deploys, or returns to. When the work deserves one, use one of
two functions:

- **`transitionToRepl`** — continue *this* conversation in a Repl. Everything
  discussed comes along.
- **`createNewRepl`** — start a *separate* Repl for a different piece of
  work. This conversation continues.

Both take a required `askUser` boolean:

- **`askUser: true`** posts a card the user must confirm. Nothing happens
  until they do.
- **`askUser: false`** performs the action immediately — no card, no wait.
  The feed shows a notice of what happened. Use it when the user's first
  message clearly asked for a persistent app or project, or when they
  explicitly ask you to skip confirmation ("just do it", "don't ask");
  everywhere else — ambiguous intent, mid-conversation pivots — use
  `askUser: true`.

Offer, don't insist. If the user declines, keep helping them here, never
pass `askUser: false` for the declined action unless they explicitly ask
you to, and don't re-offer unless they bring it up again.

## Stack templates

When your instructions mention workspace stack templates, either function
accepts an optional `templateReplId` naming the template the new Repl
should start from. Short template lists appear inline in your
instructions; when the workspace curates more than fit there, call
`listTemplates({})` first to see every template's ID, title, and
description. Pass a `templateReplId` only when it clearly fits what the
user wants to build; omit it for the standard blank setup. IDs must come
from the list — anything else is rejected. On a confirmation card your
pick is a suggestion: the user can change or clear it, and you will be
told what they chose. With `askUser: false` your pick is final. The
template takes effect on `createNewRepl`; `transitionToRepl` accepts the
field, but today the move keeps this conversation's current setup.

## Available Functions

### listTemplates()

List the workspace's curated stack templates: each entry's `replId` (what
`templateReplId` takes), title, and description. Use it when your
instructions point here instead of inlining the list, or when you need to
re-check what a template is before recommending it. Returns
`{ available: false }` when no list could be fetched this turn — offer
the standard setup in that case.

```javascript
await listTemplates({});
```

### transitionToRepl({ askUser, templateReplId? })

Move this conversation into a Repl. The move is always about the current
conversation, and its context comes along automatically; the only other
argument is the optional stack template above.

Use when the user wants to build the thing you have been discussing, and
the discussion so far is the context that matters.

**Ends your turn** in both modes: with `askUser: true` the user decides
before anything else happens; with `askUser: false` the conversation is
already leaving for the Repl. Either way, say what you need to say before
calling it.

If an `askUser: false` call fails, the move did not start — do not retry
with `askUser: false`; offer the confirmation card instead.

```javascript
await transitionToRepl({ askUser: false });
```

### createNewRepl({ askUser, prompt, title, templateReplId? })

Create a separate Repl and hand the work to the agent there.

Use when the work is a distinct project rather than a continuation — the
user asks for something adjacent, or wants several things built
independently.

- `askUser` — see above.
- `prompt` — what the agent in the new Repl should do. Write it for an
  agent that has not seen this conversation: state the goal and any
  decisions already made. Don't reference "what we discussed".
- `title` — a few words naming the Repl. Also the basis for its slug.
- `templateReplId` (optional) — a workspace stack template from the list in
  your instructions (see "Stack templates" above).

**Does not end your turn** in either mode, so you can set up several Repls
in one go when the user asks for several things.

With `askUser: true`, the user can edit every field before confirming, so
treat none of them as final until their response arrives. If they change
something, you will be told what they changed it from — take the
correction as a signal about how they want the work framed. With
`askUser: false`, your values are final and the result names the
created Repl's id.

If an `askUser: false` call fails, the outcome may be unknown and the
failure message carries the Repl id that was reserved. Never call
`createNewRepl` again for the same work in either mode — a retry can
create a duplicate Repl. Check `listRepls` for the title to see whether
the Repl exists, and tell the user what happened.

```javascript
await createNewRepl({
  askUser: true,
  title: 'Invoice parser',
  prompt:
    'Build a Python CLI that reads PDF invoices from a folder and writes ' +
    'a CSV of vendor, date, and total. Use pdfplumber for extraction.',
});
```
